import type { KillPortResult, ListeningPort } from '@shared/types'
import { AppError, ErrorCode } from '@shared/errors'
import { runCommand } from './exec'
import { killProcessTree } from '../services/process-manager/tree-kill'

export interface PortOwner {
  pid: number
  name: string
}

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

/** Lists all currently listening TCP ports on this machine with owning process info. */
export async function listListeningPorts(): Promise<ListeningPort[]> {
  if (process.platform === 'win32') {
    const [netstat, names] = await Promise.all([
      runCommand('netstat', ['-ano', '-p', 'TCP'], { timeoutMs: 8_000 }).catch(() => null),
      getWindowsProcessNameMap()
    ])
    if (!netstat || netstat.code !== 0) return []

    const seen = new Set<string>()
    const results: ListeningPort[] = []

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

      const host = localAddress.slice(0, colonIdx)
      const processName = names.get(pid) ?? (pid === 4 ? 'System' : 'unknown process')
      results.push({
        port,
        localAddress: host,
        pid,
        processName,
        isSystem: isProtectedProcess(pid, processName)
      })
    }

    return results.sort((a, b) => a.port - b.port || a.pid - b.pid)
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
