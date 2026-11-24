import type { KillPortResult, ListeningPort } from '@shared/types'
import { AppError, ErrorCode } from '@shared/errors'
import { runCommand } from './exec'
import { killProcessTree } from '../services/process-manager/tree-kill'

export interface PortOwner {
  pid: number
  name: string
}

export interface RawListeningPort {
  port: number
  localAddress: string
  pid: number
}

const DEBUGGER_PORTS = new Set([9229, 9222, 9230])
const LOOPBACK_OR_WILDCARD_HOSTS = new Set(['127.0.0.1', '0.0.0.0', '::1', '[::1]', '::', '[::]', '*'])

const PROTECTED_PROCESSES = new Set([
  'system',
  'svchost.exe',
  'lsass.exe',
  'csrss.exe',
  'wininit.exe',
  'services.exe',
  'smss.exe',
  'spoolsv.exe',
  'winlogon.exe'
])

function isProtectedProcess(pid: number, name: string): boolean {
  return pid <= 4 || pid === process.pid || PROTECTED_PROCESSES.has(name.toLowerCase())
}

async function getWindowsProcessNameMap(): Promise<Map<number, string>> {
  const map = new Map<number, string>()
  const tasklist = await runCommand('tasklist', ['/FO', 'CSV', '/NH'], { timeoutMs: 8_000 }).catch(
    () => null
  )
  if (!tasklist || tasklist.code !== 0) return map
  for (const line of tasklist.stdout.split(/\r?\n/)) {
    const match = line.match(/^"([^"]+)","(\d+)"/)
    if (match?.[1] && match[2]) {
      map.set(Number(match[2]), match[1])
    }
  }
  return map
}

/** Lists currently listening TCP sockets without resolving Windows process names. */
export async function listRawListeningPorts(): Promise<RawListeningPort[]> {
  if (process.platform === 'win32') {
    const netstat = await runCommand('netstat', ['-ano', '-p', 'TCP'], { timeoutMs: 8_000 }).catch(
      () => null
    )
    if (!netstat || netstat.code !== 0) return []

    const seen = new Set<string>()
    const results: RawListeningPort[] = []

    for (const line of netstat.stdout.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 5 || parts[0]?.toUpperCase() !== 'TCP') continue
      const localAddress = parts[1] ?? ''
      const state = parts[3]?.toUpperCase()
      const pid = Number(parts[4])
      if (state !== 'LISTENING' || !Number.isInteger(pid) || pid < 0) continue

      const colonIdx = localAddress.lastIndexOf(':')
      if (colonIdx === -1) continue
      const port = Number(localAddress.slice(colonIdx + 1))
      if (!Number.isInteger(port) || port < 1 || port > 65_535) continue

      const key = `${port}:${pid}`
      if (seen.has(key)) continue
      seen.add(key)

      results.push({
        port,
        localAddress: localAddress.slice(0, colonIdx),
        pid
      })
    }

    return results.sort((a, b) => a.port - b.port || a.pid - b.pid)
  }

  const lsof = await runCommand('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], {
    timeoutMs: 8_000
  }).catch(() => null)
  if (!lsof || lsof.code !== 0) return []

  const seen = new Set<string>()
  const results: RawListeningPort[] = []
  for (const line of lsof.stdout.split(/\r?\n/).slice(1)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 9) continue
    const pid = Number(parts[1])
    const addr = parts[8] ?? ''
    const colonIdx = addr.lastIndexOf(':')
    const port = Number(addr.slice(colonIdx + 1))
    if (!Number.isInteger(pid) || !Number.isInteger(port) || port < 1 || port > 65_535) continue
    const key = `${port}:${pid}`
    if (seen.has(key)) continue
    seen.add(key)
    results.push({
      port,
      localAddress: addr.slice(0, colonIdx) || '*',
      pid
    })
  }
  return results.sort((a, b) => a.port - b.port || a.pid - b.pid)
}

/** Lists all currently listening TCP ports on this machine with owning process info. */
export async function listListeningPorts(): Promise<ListeningPort[]> {
  if (process.platform === 'win32') {
    const [rawPorts, names] = await Promise.all([listRawListeningPorts(), getWindowsProcessNameMap()])
    return rawPorts.map((entry) => {
      const processName = names.get(entry.pid) ?? (entry.pid === 4 ? 'System' : 'unknown process')
      return {
        port: entry.port,
        localAddress: entry.localAddress,
        pid: entry.pid,
        processName,
        isSystem: isProtectedProcess(entry.pid, processName)
      }
    })
  }

  const lsof = await runCommand('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN'], {
    timeoutMs: 8_000
  }).catch(() => null)
  if (!lsof || lsof.code !== 0) return []

  const seen = new Set<string>()
  const results: ListeningPort[] = []
  for (const line of lsof.stdout.split(/\r?\n/).slice(1)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 9) continue
    const processName = parts[0] ?? 'unknown process'
    const pid = Number(parts[1])
    const addr = parts[8] ?? ''
    const colonIdx = addr.lastIndexOf(':')
    const port = Number(addr.slice(colonIdx + 1))
    if (!Number.isInteger(pid) || !Number.isInteger(port) || port < 1 || port > 65_535) continue
    const key = `${port}:${pid}`
    if (seen.has(key)) continue
    seen.add(key)
    results.push({
      port,
      localAddress: addr.slice(0, colonIdx) || '*',
      pid,
      processName,
      isSystem: isProtectedProcess(pid, processName)
    })
  }
  return results.sort((a, b) => a.port - b.port || a.pid - b.pid)
}

/** Returns the set of TCP port numbers currently in the LISTENING state. */
export async function getListeningPortNumbers(): Promise<Set<number>> {
  const ports = await listRawListeningPorts()
  return new Set(ports.map((entry) => entry.port))
}

/** Collects `rootPid` and all descendant process IDs via OS process table inspection. */
export async function getDescendantPids(rootPid: number): Promise<Set<number>> {
  const descendants = new Set<number>([rootPid])
  const parentToChildren = new Map<number, number[]>()

  if (process.platform === 'win32') {
    const result = await runCommand(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_Process | ForEach-Object { '{0},{1}' -f $_.ProcessId, $_.ParentProcessId }"
      ],
      { timeoutMs: 5_000 }
    ).catch(() => null)
    if (!result || result.code !== 0) return descendants

    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const commaIdx = trimmed.indexOf(',')
      if (commaIdx === -1) continue
      const pid = Number(trimmed.slice(0, commaIdx))
      const ppid = Number(trimmed.slice(commaIdx + 1))
      if (!Number.isInteger(pid) || !Number.isInteger(ppid) || pid <= 0 || pid === ppid) continue
      const children = parentToChildren.get(ppid)
      if (children) children.push(pid)
      else parentToChildren.set(ppid, [pid])
    }
  } else {
    const result = await runCommand('ps', ['-eo', 'pid=,ppid='], { timeoutMs: 5_000 }).catch(() => null)
    if (!result || result.code !== 0) return descendants

    for (const line of result.stdout.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length < 2) continue
      const pid = Number(parts[0])
      const ppid = Number(parts[1])
      if (!Number.isInteger(pid) || !Number.isInteger(ppid) || pid <= 0 || pid === ppid) continue
      const children = parentToChildren.get(ppid)
      if (children) children.push(pid)
      else parentToChildren.set(ppid, [pid])
    }
  }

  const queue = [rootPid]
  while (queue.length > 0) {
    const current = queue.shift() as number
    const children = parentToChildren.get(current)
    if (!children) continue
    for (const childPid of children) {
      if (!descendants.has(childPid)) {
        descendants.add(childPid)
        queue.push(childPid)
      }
    }
  }

  return descendants
}

/**
 * Finds TCP ports currently listened on by `rootPid` or any of its descendant
 * processes, sorted with application ports prioritized over debugger ports.
 */
export async function findListeningPortsForProcessTree(rootPid: number): Promise<number[]> {
  const [descendants, rawPorts] = await Promise.all([
    getDescendantPids(rootPid),
    listRawListeningPorts()
  ])

  const byPort = new Map<number, { port: number; isLoopbackOrWildcard: boolean; isDebugger: boolean }>()
  for (const entry of rawPorts) {
    if (!descendants.has(entry.pid)) continue
    const isLoopbackOrWildcard = LOOPBACK_OR_WILDCARD_HOSTS.has(entry.localAddress.toLowerCase())
    const isDebugger = DEBUGGER_PORTS.has(entry.port)
    const existing = byPort.get(entry.port)
    if (!existing || (isLoopbackOrWildcard && !existing.isLoopbackOrWildcard)) {
      byPort.set(entry.port, { port: entry.port, isLoopbackOrWildcard, isDebugger })
    }
  }

  return [...byPort.values()]
    .sort((a, b) => {
      if (a.isDebugger !== b.isDebugger) return a.isDebugger ? 1 : -1
      if (a.isLoopbackOrWildcard !== b.isLoopbackOrWildcard) return a.isLoopbackOrWildcard ? -1 : 1
      return a.port - b.port
    })
    .map((entry) => entry.port)
}

/** Looks up the process listening on a single TCP port. */
export async function findListeningPort(port: number): Promise<ListeningPort | null> {
  const all = await listListeningPorts()
  return all.find((item) => item.port === port) ?? null
}

/** Best-effort lookup of the process listening on a TCP port (Windows first). */
export async function findPortOwner(port: number): Promise<PortOwner | null> {
  const found = await findListeningPort(port)
  return found ? { pid: found.pid, name: found.processName } : null
}

/** Terminates the process listening on a TCP port (blocks critical OS/self processes). */
export async function killPortProcess(port: number): Promise<KillPortResult> {
  const entry = await findListeningPort(port)
  if (!entry) {
    throw new AppError(ErrorCode.NOT_FOUND, `No active process is listening on port ${port}.`)
  }
  if (entry.isSystem) {
    throw new AppError(
      ErrorCode.PERMISSION_DENIED,
      `Refusing to terminate protected system process "${entry.processName}" (PID ${entry.pid}).`
    )
  }
  await killProcessTree(entry.pid, true)
  return {
    port: entry.port,
    pid: entry.pid,
    processName: entry.processName
  }
}
