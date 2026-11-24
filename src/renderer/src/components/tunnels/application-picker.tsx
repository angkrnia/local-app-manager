import { useEffect, useMemo, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import type { Application, ApplicationStatus } from '@shared/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export interface ApplicationPickerProps {
  applications: Application[]
  value: string
  onChange: (applicationId: string) => void
  disabled?: boolean
}

function statusPriority(status: ApplicationStatus): number {
  if (status === 'running') return 0
  if (status === 'starting') return 1
  return 2
}

function statusDotClass(status: ApplicationStatus): string {
  if (status === 'running') return 'bg-success'
  if (status === 'starting') return 'bg-warning'
  return 'bg-muted-foreground/40'
}

export function ApplicationPicker({
  applications,
  value,
  onChange,
  disabled = false
}: ApplicationPickerProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [runningOnly, setRunningOnly] = useState(false)

  const { projectGroups, ungroupedCount, runningCount } = useMemo(() => {
    const counts = new Map<string, number>()
    let ungrouped = 0
    let running = 0

    for (const application of applications) {
      const group = application.projectName?.trim()
      if (group) {
        counts.set(group, (counts.get(group) ?? 0) + 1)
      } else {
        ungrouped += 1
      }
      if (application.status === 'running') running += 1
    }

    const groups = [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }))

    return { projectGroups: groups, ungroupedCount: ungrouped, runningCount: running }
  }, [applications])

  useEffect(() => {
    if (
      projectFilter !== 'all' &&
      projectFilter !== '__ungrouped__' &&
      !projectGroups.some((group) => group.name === projectFilter)
    ) {
      setProjectFilter('all')
    }
  }, [projectFilter, projectGroups])

  useEffect(() => {
    if (runningOnly && runningCount === 0) {
      setRunningOnly(false)
    }
  }, [runningOnly, runningCount])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matches = applications.filter((application) => {
      if (runningOnly && application.status !== 'running') return false

      const group = application.projectName?.trim() ?? ''
      if (projectFilter === '__ungrouped__' && group !== '') return false
      if (projectFilter !== 'all' && projectFilter !== '__ungrouped__' && group !== projectFilter) {
        return false
      }

      if (!term) return true
      const portText =
        application.localPort !== null
          ? String(application.localPort)
          : application.detectedPort !== null
            ? String(application.detectedPort)
            : ''
      return (
        application.name.toLowerCase().includes(term) ||
        group.toLowerCase().includes(term) ||
        application.description.toLowerCase().includes(term) ||
        application.applicationType.toLowerCase().includes(term) ||
        (application.localUrl ?? '').toLowerCase().includes(term) ||
        portText.includes(term)
      )
    })

    return matches.sort((a, b) => statusPriority(a.status) - statusPriority(b.status))
  }, [applications, search, projectFilter, runningOnly])

  const selectedApp = useMemo(
    () => applications.find((application) => application.id === value) ?? null,
    [applications, value]
  )
  const selectedHidden =
    selectedApp !== null && !filtered.some((application) => application.id === selectedApp.id)
  const hasFilters = search.trim() !== '' || projectFilter !== 'all' || runningOnly

  if (applications.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
        Add an application first, then create a tunnel for it.
      </p>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-background/40 p-2.5">
      {projectGroups.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={disabled}
            onClick={() => setProjectFilter('all')}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50',
              projectFilter === 'all'
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border bg-card/60 text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            <span>All</span>
            <span className="tabular-nums opacity-75">{applications.length}</span>
          </button>

          {projectGroups.map((group) => (
            <button
              key={group.name}
              type="button"
              disabled={disabled}
              onClick={() => setProjectFilter(group.name)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50',
                projectFilter === group.name
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-border bg-card/60 text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              <span>{group.name}</span>
              <span className="tabular-nums opacity-75">{group.count}</span>
            </button>
          ))}

          {ungroupedCount > 0 && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setProjectFilter('__ungrouped__')}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-50',
                projectFilter === '__ungrouped__'
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-border bg-card/60 text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              <span>Ungrouped</span>
              <span className="tabular-nums opacity-75">{ungroupedCount}</span>
            </button>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            disabled={disabled}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search application by name, project, or port…"
            className="h-8 pl-8 pr-7 text-xs"
            aria-label="Search applications"
          />
          {search && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>

        {runningCount > 0 && runningCount < applications.length && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => setRunningOnly((current) => !current)}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-50',
              runningOnly
                ? 'border-success/40 bg-success/15 text-success'
                : 'border-border bg-card/60 text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
            <span>Running only</span>
            <span className="tabular-nums opacity-75">{runningCount}</span>
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border py-5 text-center">
          <p className="text-xs text-muted-foreground">No matching applications.</p>
          {hasFilters && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={disabled}
              onClick={() => {
                setSearch('')
                setProjectFilter('all')
                setRunningOnly(false)
              }}
            >
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div role="listbox" aria-label="Applications" className="max-h-52 space-y-1 overflow-y-auto pr-0.5">
          {filtered.map((application) => {
            const selected = application.id === value
            const project = application.projectName?.trim()
            const address = application.localUrl?.replace(/^https?:\/\//, '') ?? 'Auto-detect'
            return (
              <button
                key={application.id}
                type="button"
                role="option"
                aria-selected={selected}
                disabled={disabled}
                onClick={() => onChange(application.id)}
                className={cn(
                  'flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50',
                  selected
                    ? 'bg-primary/10 text-foreground ring-1 ring-primary/30'
                    : 'text-foreground/90 hover:bg-accent/60'
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn('size-2 shrink-0 rounded-full', statusDotClass(application.status))}
                    title={application.status}
                  />
                  <span className="truncate font-medium">{application.name}</span>
                  {projectFilter === 'all' && project && (
                    <span className="shrink-0 rounded-full border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {project}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[11px] text-muted-foreground">{address}</span>
                  {selected && <Check className="size-3.5 text-primary" aria-hidden="true" />}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selectedHidden && selectedApp && (
        <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-1.5 text-[11px] text-muted-foreground">
          <span className="truncate">
            Selected: <span className="font-medium text-foreground">{selectedApp.name}</span> ({selectedApp.status})
          </span>
        </div>
      )}
    </div>
  )
}
