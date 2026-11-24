import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDownToLine, Copy, Eraser, Search, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import type { LogEntry, LogLevel, LogSource } from '@shared/types'
import { unwrap, errorMessage } from '@/lib/api'
import { cn, formatTime } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from './spinner'

const LEVEL_STYLES: Record<LogLevel, string> = {
  debug: 'text-zinc-500',
  info: 'text-sky-400',
  warn: 'text-amber-400',
  error: 'text-red-400'
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR'
}

export function LogViewer({
  source,
  applicationId,
  tunnelId,
  title,
  subtitle
}: {
  source: LogSource
  applicationId?: string | null
  tunnelId?: string | null
  title: string
  subtitle?: string
}): React.JSX.Element {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [level, setLevel] = useState<'all' | LogLevel>('all')
  const [search, setSearch] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [busy, setBusy] = useState<'clear' | 'export' | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  const matches = useMemo(
    () => (entry: LogEntry) =>
      entry.source === source &&
      (!applicationId || entry.applicationId === applicationId) &&
      (!tunnelId || entry.tunnelId === tunnelId),
    [source, applicationId, tunnelId]
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setEntries([])

    const unsubscribeLog = window.api.events.onLogs((batch) => {
      const relevant = batch.filter(matches)
      if (relevant.length === 0) return
      setEntries((previous) => {
        const seen = new Set(previous.map((item) => item.id))
        const fresh = relevant.filter((entry) => !seen.has(entry.id))
        if (fresh.length === 0) return previous
        return [...previous, ...fresh].slice(-5_000)
      })
    })

    const unsubscribeClear = window.api.events.onLogsCleared((payload) => {
      if (
        payload.source === source &&
        (!applicationId || payload.applicationId === applicationId) &&
        (!tunnelId || payload.tunnelId === tunnelId)
      ) {
        setEntries([])
      }
    })

    void unwrap(
      window.api.logs.query({
        source,
        applicationId: applicationId ?? undefined,
        tunnelId: tunnelId ?? undefined,
        limit: 2_000
      })
    )
      .then((initial) => {
        if (cancelled) return
        setEntries((previous) => {
          const seen = new Set(initial.map((entry) => entry.id))
          const extras = previous.filter((entry) => !seen.has(entry.id))
          return [...initial, ...extras].slice(-5_000)
        })
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.error('Could not load logs', { description: errorMessage(error) })
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      unsubscribeLog()
      unsubscribeClear()
    }
  }, [source, applicationId, tunnelId, matches])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return entries.filter((entry) => {
      if (level !== 'all' && entry.level !== level) return false
      if (term && !entry.message.toLowerCase().includes(term)) return false
      return true
    })
  }, [entries, level, search])

  // Only the visible rows (plus overscan) are mounted, so a 5.000-entry buffer
  // costs roughly the same as a 50-entry one.
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 12,
    getItemKey: (index) => filtered[index]?.id ?? index,
    measureElement: (element) => element.getBoundingClientRect().height
  })

  useEffect(() => {
    if (!autoScroll || filtered.length === 0) return
    virtualizer.scrollToIndex(filtered.length - 1, { align: 'end' })
  }, [filtered.length, autoScroll, virtualizer])

  const handleClear = async (): Promise<void> => {
    setBusy('clear')
    try {
      await unwrap(
        window.api.logs.clear({
          source,
          applicationId: applicationId ?? undefined,
          tunnelId: tunnelId ?? undefined
        })
      )
      setEntries([])
      toast.success('Logs cleared')
    } catch (error) {
      toast.error('Could not clear logs', { description: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  const handleExport = async (): Promise<void> => {
    setBusy('export')
    try {
      const result = await unwrap(
        window.api.logs.export({
          source,
          applicationId: applicationId ?? undefined,
          tunnelId: tunnelId ?? undefined,
          suggestedName: title
        })
      )
      if (result.saved && result.path) {
        toast.success('Logs saved', { description: result.path })
      }
    } catch (error) {
      toast.error('Could not export logs', { description: errorMessage(error) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{title}</p>
            {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant={autoScroll ? 'secondary' : 'ghost'}
              size="xs"
              onClick={() => setAutoScroll((value) => !value)}
              title="Toggle auto-scroll"
            >
              <ArrowDownToLine />
              Auto-scroll
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Copy logs"
              onClick={() => {
                void navigator.clipboard
                  .writeText(filtered.map((entry) => `[${entry.timestamp}] [${entry.level}] ${entry.message}`).join('\n'))
                  .then(() => toast.success('Logs copied'))
                  .catch(() => toast.error('Could not copy logs'))
              }}
            >
              <Copy />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Download logs"
              disabled={busy === 'export'}
              onClick={() => void handleExport()}
            >
              {busy === 'export' ? <Spinner /> : <ArrowDownToLine className="rotate-180" />}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title="Clear logs"
              disabled={busy === 'clear'}
              onClick={() => void handleClear()}
            >
              {busy === 'clear' ? <Spinner /> : <Eraser />}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search logs…"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Select value={level} onValueChange={(value) => setLevel(value as 'all' | LogLevel)}>
            <SelectTrigger className="h-8 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              <SelectItem value="debug">Debug</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto bg-[#08080a] py-2 font-mono text-[12px] leading-relaxed"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-zinc-500">
            <Spinner /> Loading logs…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-500">
            <Terminal className="size-5" />
            <p className="text-xs">{entries.length === 0 ? 'No log entries yet.' : 'No logs match the filter.'}</p>
          </div>
        ) : (
          <div
            style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const entry = filtered[virtualRow.index]
              if (!entry) return null
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`
                  }}
                  className={cn(
                    'flex gap-3 px-4 py-0.5 hover:bg-white/[0.03]',
                    entry.level === 'error' && 'bg-red-500/[0.04]'
                  )}
                >
                  <span className="shrink-0 select-none text-zinc-600">
                    {formatTime(entry.timestamp)}
                  </span>
                  <span
                    className={cn(
                      'w-11 shrink-0 select-none text-[10px] font-semibold uppercase leading-[1.6]',
                      LEVEL_STYLES[entry.level]
                    )}
                  >
                    {LEVEL_LABELS[entry.level]}
                  </span>
                  <span className="tm-log-line whitespace-pre-wrap text-zinc-300">{entry.message}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span>
          {filtered.length} of {entries.length} entries
        </span>
        <span>{autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}</span>
      </div>
    </div>
  )
}
