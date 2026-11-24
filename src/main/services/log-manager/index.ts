import { appendFile, mkdir, readdir, stat, truncate, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { LogEntry, LogLevel, LogQuery, LogSource } from '@shared/types'
import { LIMITS } from '@shared/constants'

export interface LogManagerOptions {
  directory: string
  maxEntriesPerSource: number
  onEntry?: (entry: LogEntry) => void
}

const LEVEL_PATTERNS: Array<{ level: LogLevel; pattern: RegExp }> = [
  { level: 'error', pattern: /\b(ERR|ERRO|ERROR|FTL|FATAL|SEVERE)\b/i },
  { level: 'warn', pattern: /\b(WRN|WARN|WARNING)\b/i },
  { level: 'debug', pattern: /\b(DBG|DEBUG|TRACE)\b/i }
]

export function detectLogLevel(line: string, fallback: LogLevel = 'info'): LogLevel {
  for (const { level, pattern } of LEVEL_PATTERNS) {
    if (pattern.test(line)) return level
  }
  return fallback
}

function sourceKey(source: LogSource, applicationId?: string | null, tunnelId?: string | null): string {
  if (source === 'application' && applicationId) return `application-${applicationId}`
  if (source === 'tunnel' && tunnelId) return `tunnel-${tunnelId}`
  return 'system'
}

function fileNameForKey(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `${safe}.log`
}

function lineForEntry(entry: LogEntry): string {
  return `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.source}${
    entry.applicationId ? `:${entry.applicationId}` : entry.tunnelId ? `:${entry.tunnelId}` : ''
  }] ${entry.message}\n`
}

/**
 * Keeps a bounded in-memory log buffer for the UI and appends entries to
 * per-source log files. File writes are batched to avoid blocking the process.
 */
export class LogManager {
  private buckets = new Map<string, LogEntry[]>()
  private directory: string
  private maxEntriesPerSource: number
  private onEntry?: (entry: LogEntry) => void
  private pendingWrites = new Map<string, string>()
  private flushTimer: NodeJS.Timeout | null = null
  private closed = false

  constructor(options: LogManagerOptions) {
    this.directory = options.directory
    this.maxEntriesPerSource = Math.max(100, options.maxEntriesPerSource)
    this.onEntry = options.onEntry
  }

  setOnEntry(callback: (entry: LogEntry) => void): void {
    this.onEntry = callback
  }

  configure(directory: string, maxEntriesPerSource: number): void {
    this.directory = directory
    this.maxEntriesPerSource = Math.max(100, maxEntriesPerSource)
    this.trimAll()
  }

  getDirectory(): string {
    return this.directory
  }

  log(input: {
    source: LogSource
    message: string
    level?: LogLevel
    applicationId?: string | null
    tunnelId?: string | null
    stream?: 'stdout' | 'stderr' | 'system'
  }): LogEntry {
    const message = input.message.slice(0, LIMITS.logMessage)
    const entry: LogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      level: input.level ?? detectLogLevel(message),
      source: input.source,
      applicationId: input.applicationId ?? null,
      tunnelId: input.tunnelId ?? null,
      message,
      stream: input.stream ?? (input.source === 'system' ? 'system' : 'stdout')
    }

    const key = sourceKey(input.source, input.applicationId, input.tunnelId)
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = []
      this.buckets.set(key, bucket)
    }
    bucket.push(entry)
    // Trim in chunks (amortized O(1) instead of O(N) on every single line).
    if (bucket.length > this.maxEntriesPerSource + 200) {
      bucket.splice(0, bucket.length - this.maxEntriesPerSource)
    }
    this.queueWrite(key, lineForEntry(entry))
    this.onEntry?.(entry)
    return entry
  }

  query(query: LogQuery = {}): LogEntry[] {
    const limit = Math.min(Math.max(query.limit ?? 2_000, 1), LIMITS.maxLogsPerQuery)
    const search = query.search?.toLowerCase()

    let candidates: LogEntry[]
    if (query.source === 'application' && query.applicationId) {
      candidates = this.buckets.get(`application-${query.applicationId}`) ?? []
    } else if (query.source === 'tunnel' && query.tunnelId) {
      candidates = this.buckets.get(`tunnel-${query.tunnelId}`) ?? []
    } else if (query.source === 'system') {
      candidates = this.buckets.get('system') ?? []
    } else {
      candidates = []
      for (const bucket of this.buckets.values()) {
        for (const entry of bucket) candidates.push(entry)
      }
      candidates.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    }

    const filtered = candidates.filter((entry) => {
      if (query.source && entry.source !== query.source) return false
      if (query.applicationId && entry.applicationId !== query.applicationId) return false
      if (query.tunnelId && entry.tunnelId !== query.tunnelId) return false
      if (query.level && entry.level !== query.level) return false
      if (search && !entry.message.toLowerCase().includes(search)) return false
      return true
    })
    return filtered.slice(-limit)
  }

  clear(query: Pick<LogQuery, 'source' | 'applicationId' | 'tunnelId'>): string[] {
    const keys: string[] = []
    for (const [key, bucket] of this.buckets.entries()) {
      const remaining = bucket.filter((entry) => {
        const matches =
          (!query.source || entry.source === query.source) &&
          (!query.applicationId || entry.applicationId === query.applicationId) &&
          (!query.tunnelId || entry.tunnelId === query.tunnelId)
        if (matches) {
          keys.push(key)
          return false
        }
        return true
      })
      if (remaining.length === 0) this.buckets.delete(key)
      else this.buckets.set(key, remaining)
    }
    return [...new Set(keys)]
  }

  async truncateFiles(keys: string[]): Promise<void> {
    await Promise.all(
      keys.map(async (key) => {
        try {
          await truncate(join(this.directory, fileNameForKey(key)), 0)
        } catch {
          // File may not exist yet.
        }
      })
    )
  }

  format(query: LogQuery = {}): string {
    return this.query({ ...query, limit: LIMITS.maxLogsPerQuery })
      .map((entry) => `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`)
      .join('\r\n')
  }

  private trimAll(): void {
    for (const bucket of this.buckets.values()) {
      if (bucket.length > this.maxEntriesPerSource) {
        bucket.splice(0, bucket.length - this.maxEntriesPerSource)
      }
    }
  }

  private queueWrite(key: string, line: string): void {
    if (this.closed) return
    const pending = this.pendingWrites.get(key) ?? ''
    this.pendingWrites.set(key, pending + line)
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null
        void this.flush()
      }, 600)
      this.flushTimer.unref?.()
    }
  }

  async flush(): Promise<void> {
    if (this.pendingWrites.size === 0) return
    const batch = this.pendingWrites
    this.pendingWrites = new Map()
    try {
      await mkdir(this.directory, { recursive: true })
      await Promise.all(
        [...batch.entries()].map(async ([key, content]) => {
          try {
            await appendFile(join(this.directory, fileNameForKey(key)), content, 'utf8')
          } catch {
            // Logging must never crash the app.
          }
        })
      )
    } catch {
      // Ignore filesystem errors.
    }
  }

  async cleanup(retentionDays: number): Promise<number> {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1_000
    let removed = 0
    try {
      const files = await readdir(this.directory)
      for (const file of files) {
        if (!file.endsWith('.log')) continue
        const fullPath = join(this.directory, file)
        try {
          const info = await stat(fullPath)
          if (info.mtimeMs < cutoff) {
            await writeFile(fullPath, '')
            removed += 1
          }
        } catch {
          // Skip files that disappear mid-cleanup.
        }
      }
    } catch {
      // Directory does not exist yet.
    }
    return removed
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.closed = true
    await this.flush()
  }
}
