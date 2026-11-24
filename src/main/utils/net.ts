import { createConnection } from 'node:net'

export function isPortInUse(host: string, port: number, timeoutMs = 1_500): Promise<boolean> {
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
