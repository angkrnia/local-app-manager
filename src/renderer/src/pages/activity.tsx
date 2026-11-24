import { useMemo, useState } from 'react'
import { Eraser, Search, ScrollText } from 'lucide-react'
import type { LogLevel } from '@shared/types'
import { runAction } from '@/lib/run'
import { cn, formatDateTime } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

const LEVEL_STYLES: Record<LogLevel, string> = {
  debug: 'border-border bg-muted/40 text-muted-foreground',
  info: 'border-sky-500/25 bg-sky-500/10 text-sky-500',
  warn: 'border-warning/30 bg-warning/10 text-warning',
  error: 'border-destructive/30 bg-destructive/10 text-destructive'
}

export default function ActivityPage(): React.JSX.Element {
  const activity = useAppStore((state) => state.activity)
  const [search, setSearch] = useState('')
  const [level, setLevel] = useState<'all' | LogLevel>('all')
  const [clearOpen, setClearOpen] = useState(false)

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return activity.filter((entry) => {
      if (level !== 'all' && entry.level !== level) return false
      if (term) {
        const haystack = [entry.message, entry.applicationName, entry.tunnelName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
  }, [activity, level, search])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        description="A durable history of application and tunnel lifecycle events."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={activity.length === 0}
            onClick={() => setClearOpen(true)}
          >
            <Eraser />
            Clear activity
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search activity…"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <Select value={level} onValueChange={(value) => setLevel(value as 'all' | LogLevel)}>
          <SelectTrigger className="h-9 w-36 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All levels</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warn">Warn</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="debug">Debug</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {activity.length}
        </span>
      </div>

      <Card className="overflow-hidden">
        {activity.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No activity recorded"
            description="Starting applications, creating tunnels and changing settings will show up here."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title="Nothing matches"
            description="Try another search term or level."
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSearch('')
                  setLevel('all')
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className="divide-y divide-border/60">
            {filtered.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:gap-4">
                <span className="w-32 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {formatDateTime(entry.createdAt)}
                </span>
                <span
                  className={cn(
                    'w-14 shrink-0 rounded-md border px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase',
                    LEVEL_STYLES[entry.level]
                  )}
                >
                  {entry.level}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground/90">{entry.message}</p>
                  {(entry.applicationName || entry.tunnelName) && (
                    <p className="mt-0.5 text-[10px] text-muted-foreground">
                      {[entry.applicationName, entry.tunnelName].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title="Clear all activity?"
        description="This permanently removes the activity history. Application and tunnel logs are not affected."
        confirmLabel="Clear activity"
        onConfirm={async () => {
          const cleared = await runAction(() => window.api.activity.clear(), {
            success: 'Activity cleared',
            error: 'Could not clear activity'
          })
          if (cleared) useAppStore.getState().setActivity([])
          setClearOpen(false)
        }}
      />
    </div>
  )
}
