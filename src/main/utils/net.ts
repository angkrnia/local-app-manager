import { createConnection } from 'node:net'

/**
 * Strips brackets from an IPv6 literal and formats a host safely for URLs
 * (wrapping IPv6 literals containing `:` in `[...]`).
 */
export function formatHostForUrl(host: string): string {
  const bare = host.trim().replace(/^\[|\]$/g, '')
  return bare.includes(':') ? `[${bare}]` : bare
}

/**
 * Returns the ordered list of host addresses to probe for TCP/HTTP checks.
 * Loopback addresses fall back between IPv4 (`127.0.0.1`) and IPv6 (`::1`)
 * because dev servers on Windows (such as Vite/Nuxt) often bind only `::1`.
 */
export function getProbeHosts(host: string): string[] {
  const bare = host.trim().replace(/^\[|\]$/g, '')
  const lower = bare.toLowerCase()
  if (lower === '127.0.0.1' || lower === '0.0.0.0' || lower === 'localhost') {
    return ['127.0.0.1', '::1']
  }
  if (lower === '::1' || lower === '::') {
    return ['::1', '127.0.0.1']
  }
  return [bare]
}

function probeSingleHostTcp(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    let settled = false

    const finish = (result: boolean): void => {
      if (settled) return
      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export async function isPortInUse(host: string, port: number, timeoutMs = 1_500): Promise<boolean> {
  const hosts = getProbeHosts(host)
  if (hosts.length === 1) {
    return probeSingleHostTcp(hosts[0] as string, port, timeoutMs)
  }
  const results = await Promise.all(hosts.map((target) => probeSingleHostTcp(target, port, timeoutMs)))
  return results.some(Boolean)
}

export async function waitForPort(
  host: string,
  port: number,
  options: { timeoutMs: number; intervalMs: number; shouldAbort?: () => boolean }
): Promise<boolean> {
  const deadline = Date.now() + options.timeoutMs
  while (Date.now() < deadline) {
    if (options.shouldAbort?.()) return false
    if (await isPortInUse(host, port, 1_000)) return true
    await sleep(options.intervalMs)
  }
  return false
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
