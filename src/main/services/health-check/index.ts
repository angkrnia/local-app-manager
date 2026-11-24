import http from 'node:http'
import https from 'node:https'
import type { LocalProtocol } from '@shared/types'
import { isPortInUse, sleep } from '../../utils/net'

export interface HealthCheckResult {
  healthy: boolean
  statusCode: number | null
  latencyMs: number
  error: string | null
}

export interface WaitForHealthOptions {
  host: string
  port: number
  protocol: LocalProtocol
  timeoutMs: number
  intervalMs: number
  shouldAbort?: () => boolean
}

export interface WaitForHealthResult {
  healthy: boolean
  attempts: number
  lastResult: HealthCheckResult | null
}

/**
 * Performs an HTTP health probe against a local application. Any response with
 * a status below 500 counts as healthy (404/401 still mean the server is up).
 */
export function checkHttpHealth(options: {
  host: string
  port: number
  protocol: LocalProtocol
  path?: string
  timeoutMs?: number
}): Promise<HealthCheckResult> {
  const { host, port, protocol, path = '/', timeoutMs = 4_000 } = options
  const startedAt = Date.now()
  const transport = protocol === 'https' ? https : http

  return new Promise((resolve) => {
    let settled = false
    const finish = (result: Omit<HealthCheckResult, 'latencyMs'>): void => {
      if (settled) return
      settled = true
      resolve({ ...result, latencyMs: Date.now() - startedAt })
    }

    let request: http.ClientRequest
    try {
      request = transport.request(
        {
          host,
          port,
          path,
          method: 'GET',
          timeout: timeoutMs,
          // Local development servers frequently use self-signed certificates.
          rejectUnauthorized: false,
          headers: {
            'User-Agent': 'TunnelManager/1.0 (health-check)',
            Accept: '*/*',
            Connection: 'close'
          }
        },
        (response) => {
          const statusCode = response.statusCode ?? null
          response.resume()
          response.destroy()
          finish({
            healthy: statusCode !== null && statusCode < 500,
            statusCode,
            error:
              statusCode !== null && statusCode < 500
                ? null
                : `Server responded with HTTP ${statusCode ?? 'unknown'}`
          })
        }
      )
    } catch (error) {
      finish({ healthy: false, statusCode: null, error: (error as Error).message })
      return
    }

    request.on('timeout', () => {
      request.destroy(new Error(`Health check timed out after ${timeoutMs}ms`))
    })
    request.on('error', (error) => {
      finish({ healthy: false, statusCode: null, error: error.message })
    })
    request.end()
  })
}

export function checkTcpHealth(host: string, port: number, timeoutMs = 2_000): Promise<HealthCheckResult> {
  const startedAt = Date.now()
  return isPortInUse(host, port, timeoutMs).then((open) => ({
    healthy: open,
    statusCode: null,
    latencyMs: Date.now() - startedAt,
    error: open ? null : `No process is listening on ${host}:${port}`
  }))
}

export async function waitForHealth(options: WaitForHealthOptions): Promise<WaitForHealthResult> {
  const deadline = Date.now() + options.timeoutMs
  let attempts = 0
  let lastResult: HealthCheckResult | null = null

  while (Date.now() < deadline) {
    if (options.shouldAbort?.()) {
      return { healthy: false, attempts, lastResult }
    }
    attempts += 1
    lastResult = await checkHttpHealth({
      host: options.host,
      port: options.port,
      protocol: options.protocol,
      timeoutMs: Math.min(4_000, Math.max(1_000, options.intervalMs))
    })
    if (lastResult.healthy) {
      return { healthy: true, attempts, lastResult }
    }
    await sleep(options.intervalMs)
  }

  return { healthy: false, attempts, lastResult }
}
