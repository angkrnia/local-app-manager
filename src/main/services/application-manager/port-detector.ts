import type { LocalProtocol } from '@shared/types'
import { stripAnsi } from '../../utils/ansi'
import { sleep } from '../../utils/net'
import { findListeningPortsForProcessTree } from '../../utils/port-info'
import { checkHttpHealth } from '../health-check'

const LOCAL_URL_PORT_PATTERN =
  /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|::1?):(\d{2,5})\b/gi
const LISTEN_PORT_KEYWORD_PATTERN =
  /(?:listening|running|started|serving|bound|ready|accepting(?:\s+connections)?)\s+(?:on|at)\s+port\s+(\d{2,5})\b/gi
const LISTEN_HOST_PORT_PATTERN =
  /(?:listening|running|started|serving|bound|ready)\s+(?:on|at)\s+(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\*)?:(\d{2,5})\b(?!:\d)/gi
const STRUCTURED_PORT_PATTERN =
  /(?:^|[\s{,])["']?PORT["']?\s*[:=]\s*["']?(\d{2,5})["']?(?=[\s,;}]|$)/gi

const PORT_EXTRACTION_PATTERNS = [
  LOCAL_URL_PORT_PATTERN,
  LISTEN_PORT_KEYWORD_PATTERN,
  LISTEN_HOST_PORT_PATTERN,
  STRUCTURED_PORT_PATTERN
]

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65_535
}

/**
 * Extracts candidate TCP ports from application stdout/stderr text while
 * avoiding false positives from timestamps or dates.
 */
export function extractPortsFromText(text: string): number[] {
  const clean = stripAnsi(text)
  const found: number[] = []
  const seen = new Set<number>()

  for (const pattern of PORT_EXTRACTION_PATTERNS) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(clean)) !== null) {
      const port = Number(match[1])
      if (isValidPort(port) && !seen.has(port)) {
        seen.add(port)
        found.push(port)
      }
    }
  }

  return found
}

/** Collects unique candidate ports from streamed application log lines. */
export class LogPortDetector {
  private readonly candidates: number[] = []
  private readonly seen = new Set<number>()

  push(line: string): number[] {
    const discovered: number[] = []
    for (const port of extractPortsFromText(line)) {
      if (!this.seen.has(port)) {
        this.seen.add(port)
        this.candidates.push(port)
        discovered.push(port)
      }
    }
    return discovered
  }

  addCandidate(port: number): void {
    if (isValidPort(port) && !this.seen.has(port)) {
      this.seen.add(port)
      this.candidates.push(port)
    }
  }

  getCandidates(): number[] {
    return [...this.candidates]
  }
}

export interface WaitForAutoDetectedPortOptions {
  host: string
  protocol: LocalProtocol
  timeoutMs: number
  intervalMs: number
  getPid: () => number | null
  logDetector: LogPortDetector
  preExistingPorts: Set<number>
  shouldAbort?: () => boolean
}

export interface WaitForAutoDetectedPortResult {
  healthy: boolean
  port: number | null
  lastError: string | null
}

/**
 * Polls candidate ports from log hints (excluding ports that were already open
 * before launch) and falls back to OS process-tree TCP socket inspection until
 * a local HTTP server responds or the timeout expires.
 */
export async function waitForAutoDetectedPort(
  options: WaitForAutoDetectedPortOptions
): Promise<WaitForAutoDetectedPortResult> {
  const deadline = Date.now() + options.timeoutMs
  const probeTimeoutMs = Math.min(2_500, Math.max(500, options.intervalMs))
  let lastError: string | null = null

  while (Date.now() < deadline) {
    if (options.shouldAbort?.()) {
      return { healthy: false, port: null, lastError }
    }

    const logCandidates = options.logDetector
      .getCandidates()
      .filter((port) => !options.preExistingPorts.has(port))

    for (const port of logCandidates) {
      if (options.shouldAbort?.()) {
        return { healthy: false, port: null, lastError }
      }
      const probe = await checkHttpHealth({
        host: options.host,
        port,
        protocol: options.protocol,
        timeoutMs: probeTimeoutMs
      })
      if (probe.healthy) {
        return { healthy: true, port, lastError: null }
      }
      lastError = probe.error
    }

    const pid = options.getPid()
    if (pid !== null && !options.shouldAbort?.()) {
      const treePorts = await findListeningPortsForProcessTree(pid)
      for (const port of treePorts) {
        if (options.shouldAbort?.()) {
          return { healthy: false, port: null, lastError }
        }
        const probe = await checkHttpHealth({
          host: options.host,
          port,
          protocol: options.protocol,
          timeoutMs: probeTimeoutMs
        })
        if (probe.healthy) {
          return { healthy: true, port, lastError: null }
        }
        lastError = probe.error
      }
    }

    if (options.shouldAbort?.()) {
      return { healthy: false, port: null, lastError }
    }
    await sleep(options.intervalMs)
  }

  return { healthy: false, port: null, lastError }
}
