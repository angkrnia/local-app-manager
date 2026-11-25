import http from 'node:http'
import https from 'node:https'
import type { LocalProtocol } from '@shared/types'
import { getProbeHosts, isPortInUse, sleep } from '../../utils/net'

export interface HealthCheckResult {
  healthy: boolean
  statusCode: number | null
  latencyMs: number
  error: string | null
  resolvedHost?: string | null
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
 * Determines whether an HTTP response indicates a live web application rather
 * than a WebSocket-only HMR endpoint (which typically replies with 426 Upgrade Required).
 */
export function isHealthyHttpResponse(
  statusCode: number | null,
  headers: http.IncomingHttpHeaders
): boolean {
  if (statusCode === null || statusCode >= 500 || statusCode === 426) {
    return false
  }
  const upgrade = String(headers.upgrade ?? '').toLowerCase()
  if (statusCode >= 400 && upgrade.includes('websocket')) {
    return false
  }
  return true
}

function probeSingleHostHttpHealth(options: {
  host: string
  port: number
  protocol: LocalProtocol
  path: string
  timeoutMs: number
}): Promise<HealthCheckResult> {
  const { host, port, protocol, path, timeoutMs } = options
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
          const healthy = isHealthyHttpResponse(statusCode, response.headers)
          response.resume()
          response.destroy()
          finish({
            healthy,
            statusCode,
            resolvedHost: healthy ? host : null,
            error: healthy
              ? null
              : statusCode === 426
                ? 'Endpoint requires WebSocket upgrade (HTTP 426)'
                : `Server responded with HTTP ${statusCode ?? 'unknown'}`
          })
        }
      )
    } catch (error) {
      finish({ healthy: false, statusCode: null, resolvedHost: null, error: (error as Error).message })
      return
    }

    request.on('timeout', () => {
      request.destroy(new Error(`Health check timed out after ${timeoutMs}ms`))
    })
    request.on('error', (error) => {
      finish({ healthy: false, statusCode: null, resolvedHost: null, error: error.message })
    })
    request.end()
  })
}

/**
 * Performs an HTTP health probe against a local application. Any response with
 * a status below 500 (excluding WebSocket-only 426 endpoints) counts as healthy.
 * Loopback hosts automatically try both IPv4 and IPv6.
 */
export async function checkHttpHealth(options: {
  host: string
  port: number
  protocol: LocalProtocol
  path?: string
  timeoutMs?: number
}): Promise<HealthCheckResult> {
  const { host, port, protocol, path = '/', timeoutMs = 4_000 } = options
  const hosts = getProbeHosts(host)
  const startedAt = Date.now()
  let primaryResult: HealthCheckResult | null = null
  let httpResponseResult: HealthCheckResult | null = null

  for (const candidateHost of hosts) {
    const remaining = Math.max(400, timeoutMs - (Date.now() - startedAt))
    const result = await probeSingleHostHttpHealth({
      host: candidateHost,
      port,
      protocol,
      path,
      timeoutMs: remaining
    })
    if (result.healthy) {
      return result
    }
    if (!primaryResult) {
      primaryResult = result
    }
    if (result.statusCode !== null) {
      httpResponseResult = result
    }
  }

  return httpResponseResult ?? primaryResult ?? {
    healthy: false,
    statusCode: null,
    latencyMs: Date.now() - startedAt,
    error: `No response from ${host}:${port}`,
    resolvedHost: null
  }
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
