import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Boxes,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FolderOpen,
  Globe2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCw,
  Search,
  Square,
  Terminal,
  Trash2,
  Power
} from 'lucide-react'
import type { Application, ApplicationType } from '@shared/types'
import { APPLICATION_TYPE_OPTIONS } from '@shared/constants'
import { applicationTypeLabel } from '@/lib/labels'
import { run } from '@/lib/run'
import { unwrap } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { useExposure } from '@/components/shared/exposure-provider'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { CopyButton } from '@/components/shared/copy-button'
import { Spinner } from '@/components/shared/spinner'
import { LogSheet } from '@/components/shared/log-sheet'
import { ApplicationFormDialog } from '@/components/applications/application-form-dialog'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

type StatusFilter = 'all' | 'running' | 'stopped' | 'error'

export default function ApplicationsPage(): React.JSX.Element {
  const applications = useAppStore((state) => state.applications)
  const tunnels = useAppStore((state) => state.tunnels)
  const settings = useAppStore((state) => state.settings)
  const { ensureAccepted } = useExposure()
  const [searchParams, setSearchParams] = useSearchParams()

  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | ApplicationType>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Application | null>(null)
  const [logsFor, setLogsFor] = useState<Application | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Application | null>(null)
  const [stopTarget, setStopTarget] = useState<Application | null>(null)
  const [stopAllOpen, setStopAllOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState<'start' | 'stop' | null>(null)

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      setEditing(null)
      setFormOpen(true)
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  const { projectGroups, ungroupedCount } = useMemo(() => {
    const counts = new Map<string, number>()
    let ungrouped = 0
    for (const application of applications) {
      const group = application.projectName?.trim()
      if (group) {
        counts.set(group, (counts.get(group) ?? 0) + 1)
      } else {
        ungrouped += 1
      }
    }
    const groups = [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }))
    return { projectGroups: groups, ungroupedCount: ungrouped }
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

  const projectScopedApps = useMemo(() => {
    if (projectFilter === 'all') return applications
    if (projectFilter === '__ungrouped__') {
      return applications.filter((application) => !application.projectName?.trim())
    }
    return applications.filter((application) => application.projectName?.trim() === projectFilter)
  }, [applications, projectFilter])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return projectScopedApps.filter((application) => {
      if (typeFilter !== 'all' && application.applicationType !== typeFilter) return false
      if (statusFilter !== 'all' && application.status !== statusFilter) return false
      if (
        term &&
        !application.name.toLowerCase().includes(term) &&
        !(application.projectName ?? '').toLowerCase().includes(term) &&
        !application.description.toLowerCase().includes(term) &&
        !(application.localUrl ?? '').toLowerCase().includes(term)
      ) {
        return false
      }
      return true
    })
  }, [projectScopedApps, search, typeFilter, statusFilter])

  const start = async (application: Application): Promise<void> => {
    setBusyId(application.id)
    await run(() => window.api.applications.start(application.id), {
      loading: `Starting ${application.name}…`,
      success: `${application.name} started`,
      error: 'Could not start application'
    })
    setBusyId(null)
  }

  const stop = async (application: Application): Promise<void> => {
    setBusyId(application.id)
    await run(() => window.api.applications.stop(application.id), {
      loading: `Stopping ${application.name}…`,
      success: `${application.name} stopped`,
      error: 'Could not stop application'
    })
    setBusyId(null)
  }

  const restart = async (application: Application): Promise<void> => {
    setBusyId(application.id)
    await run(() => window.api.applications.restart(application.id), {
      loading: `Restarting ${application.name}…`,
      success: `${application.name} restarted`,
      error: 'Could not restart application'
    })
    setBusyId(null)
  }

  const expose = async (application: Application): Promise<void> => {
    if (!(await ensureAccepted())) return
    setBusyId(application.id)
    await run(() => window.api.applications.startAndExpose(application.id), {
      loading: `Exposing ${application.name}…`,
      success: () => `${application.name} is publicly available`,
      error: 'Start & Expose failed'
    })
    setBusyId(null)
  }

  const duplicate = async (application: Application): Promise<void> => {
    setBusyId(application.id)
    const created = await run(() => window.api.applications.duplicate(application.id), {
      loading: 'Duplicating application…',
      success: (copy) => `Created "${copy.name}"`,
      error: 'Could not duplicate application'
    })
    setBusyId(null)
    if (created) {
      setEditing(created)
      setFormOpen(true)
    }
  }

  const openLocalUrl = (application: Application): void => {
    void run(() => window.api.applications.openLocalUrl(application.id), {
      error: 'Could not open the local URL'
    })
  }

  const openDirectory = (application: Application): void => {
    void run(() => window.api.applications.openDirectory(application.id), {
      error: 'Could not open the project directory'
    })
  }

  const tunnelsFor = (applicationId: string) =>
    tunnels.filter((tunnel) => tunnel.applicationId === applicationId)

  const isFiltered =
    projectFilter !== 'all' || search.trim() !== '' || typeFilter !== 'all' || statusFilter !== 'all'

  const moveApplication = async (index: number, direction: -1 | 1): Promise<void> => {
    const targetIndex = index + direction
    if (isFiltered || targetIndex < 0 || targetIndex >= applications.length) return
    const next = [...applications]
    const [moved] = next.splice(index, 1)
    if (!moved) return
    next.splice(targetIndex, 0, moved)
    useAppStore.getState().setApplications(next)
    const saved = await run(
      () => window.api.applications.reorder(next.map((item) => item.id)),
      { error: 'Could not save application order' }
    )
    if (!saved) {
      await useAppStore.getState().refreshApplications()
    }
  }

  const openPublicUrl = (tunnelId: string): void => {
    void run(() => window.api.tunnels.openPublicUrl(tunnelId), {
      error: 'Could not open the public URL'
    })
  }

  const stoppedApps = projectScopedApps.filter(
    (application) => application.status !== 'running' && application.status !== 'starting'
  )
  const activeApps = projectScopedApps.filter(
    (application) =>
      application.pid !== null ||
      application.status === 'running' ||
      application.status === 'starting'
  )

  const startAll = async (): Promise<void> => {
    if (stoppedApps.length === 0) return
    setBatchBusy('start')
    const toastId = toast.loading(`Starting ${stoppedApps.length} application(s)…`)
    const results = await Promise.allSettled(
      stoppedApps.map((application) => unwrap(window.api.applications.start(application.id)))
    )
    const succeeded = results.filter((result) => result.status === 'fulfilled').length
    const failed = results.length - succeeded
    if (failed === 0) {
      toast.success(`Started ${succeeded} application(s)`, { id: toastId })
    } else if (succeeded > 0) {
      toast.warning(`Started ${succeeded}, ${failed} failed`, { id: toastId })
    } else {
      toast.error('Could not start applications', { id: toastId })
    }
    setBatchBusy(null)
  }

  const stopAll = async (): Promise<void> => {
    if (activeApps.length === 0) return
    setBatchBusy('stop')
    const toastId = toast.loading(`Stopping ${activeApps.length} application(s)…`)
    const results = await Promise.allSettled(
      activeApps.map((application) => unwrap(window.api.applications.stop(application.id)))
    )
    const succeeded = results.filter((result) => result.status === 'fulfilled').length
    const failed = results.length - succeeded
    if (failed === 0) {
      toast.success(`Stopped ${succeeded} application(s)`, { id: toastId })
    } else if (succeeded > 0) {
      toast.warning(`Stopped ${succeeded}, ${failed} failed`, { id: toastId })
    } else {
      toast.error('Could not stop applications', { id: toastId })
    }
    setBatchBusy(null)
  }

  const scopeLabel =
    projectFilter === 'all'
      ? 'all'
      : projectFilter === '__ungrouped__'
        ? 'ungrouped'
        : projectFilter

  return (
    <div className="space-y-5">
      <PageHeader
        title="Applications"
        description="Run local servers and optionally expose them through Cloudflare Tunnel."
        actions={
          <>
            {applications.length > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={batchBusy !== null || stoppedApps.length === 0}
                  onClick={() => void startAll()}
                >
                  {batchBusy === 'start' ? <Spinner /> : <Play />}
                  {projectFilter === 'all' ? 'Start all' : `Start ${scopeLabel}`}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={batchBusy !== null || activeApps.length === 0}
                  onClick={() => setStopAllOpen(true)}
                >
                  {batchBusy === 'stop' ? <Spinner /> : <Square />}
                  {projectFilter === 'all' ? 'Stop all' : `Stop ${scopeLabel}`}
                </Button>
              </>
            )}
            <Button
              size="sm"
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              <Plus />
              Add application
            </Button>
          </>
        }
      />

      {applications.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setProjectFilter('all')}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              projectFilter === 'all'
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border bg-card/60 text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            <span>All projects</span>
            <span className="tabular-nums opacity-75">{applications.length}</span>
          </button>

          {projectGroups.map((group) => (
            <button
              key={group.name}
              type="button"
              onClick={() => setProjectFilter(group.name)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                projectFilter === group.name
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-border bg-card/60 text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              <span>{group.name}</span>
              <span className="tabular-nums opacity-75">{group.count}</span>
            </button>
          ))}

          {projectGroups.length > 0 && ungroupedCount > 0 && (
            <button
              type="button"
              onClick={() => setProjectFilter('__ungrouped__')}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
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

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search applications…"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as 'all' | ApplicationType)}>
          <SelectTrigger className="h-9 w-40 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {APPLICATION_TYPE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
          <SelectTrigger className="h-9 w-36 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="stopped">Stopped</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-muted-foreground">
          {filtered.length} of {applications.length}
        </span>
      </div>

      <Card className="overflow-hidden">
        {applications.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No applications yet"
            description="Add the local project you want to run. Local App Manager supports Node, Vite, Next.js, Laravel, PHP, Python, Docker and custom commands."
            action={
              <Button size="sm" onClick={() => setFormOpen(true)}>
                <Plus />
                Add your first application
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No matches"
            description="Try a different search term or clear the filters."
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSearch('')
                  setProjectFilter('all')
                  setTypeFilter('all')
                  setStatusFilter('all')
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-center">Order</TableHead>
                <TableHead>Application</TableHead>
                <TableHead>Local URL</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Public Tunnel</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((application, index) => {
                const busy = busyId === application.id
                const running = application.status === 'running'
                const appTunnels = tunnelsFor(application.id)
                const activeTunnel =
                  appTunnels.find((tunnel) => tunnel.status === 'running' && tunnel.publicUrl) ??
                  appTunnels.find((tunnel) => tunnel.publicUrl) ??
                  null
                return (
                  <TableRow key={application.id}>
                    <TableCell className="w-12 px-2">
                      <div className="flex flex-col items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="size-5 text-muted-foreground hover:text-foreground"
                          disabled={isFiltered || index === 0}
                          aria-label={`Move ${application.name} up`}
                          title={isFiltered ? 'Clear filters to reorder' : 'Move up'}
                          onClick={() => void moveApplication(index, -1)}
                        >
                          <ChevronUp className="size-3.5" aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="size-5 text-muted-foreground hover:text-foreground"
                          disabled={isFiltered || index === filtered.length - 1}
                          aria-label={`Move ${application.name} down`}
                          title={isFiltered ? 'Clear filters to reorder' : 'Move down'}
                          onClick={() => void moveApplication(index, 1)}
                        >
                          <ChevronDown className="size-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[320px]">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-sm font-medium">{application.name}</p>
                          {application.projectName && (
                            <button
                              type="button"
                              onClick={() => setProjectFilter(application.projectName)}
                              className="shrink-0 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                              title={`Filter by ${application.projectName}`}
                            >
                              {application.projectName}
                            </button>
                          )}
                        </div>
                        <p className="truncate text-[11px] text-muted-foreground">
                          <span>{applicationTypeLabel(application.applicationType)}</span>
                          <span className="mx-1.5 opacity-50">·</span>
                          <span>{application.description || application.projectDirectory}</span>
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {application.localUrl ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openLocalUrl(application)}
                            className="max-w-[190px] truncate font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                            title={application.localUrl}
                          >
                            {application.localUrl.replace(/^https?:\/\//, '')}
                          </button>
                          {application.localPort === null && (
                            <span
                              className="rounded bg-muted px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground"
                              title={`Auto-detected port ${application.detectedPort}`}
                            >
                              auto
                            </span>
                          )}
                          <CopyButton value={application.localUrl} label="Copy local URL" toastOnCopy={false} />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {application.status === 'starting' ? 'Detecting port…' : 'Auto-detect'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <StatusBadge status={application.status} health={application.health} />
                        {application.lastError && application.status === 'error' && (
                          <span className="max-w-[180px] truncate text-[10px] text-destructive" title={application.lastError}>
                            {application.lastError}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {appTunnels.length === 0 ? (
                        <span className="text-xs text-muted-foreground">Local only</span>
                      ) : activeTunnel?.publicUrl ? (
                        <div className="flex items-center gap-1">
                          <span
                            className={cn(
                              'size-1.5 shrink-0 rounded-full',
                              activeTunnel.status === 'running' ? 'bg-success' : 'bg-muted-foreground/50'
                            )}
                          />
                          <button
                            type="button"
                            onClick={() => openPublicUrl(activeTunnel.id)}
                            className="max-w-[240px] truncate font-mono text-xs text-primary transition-colors hover:underline"
                            title={activeTunnel.publicUrl}
                          >
                            {activeTunnel.publicUrl.replace(/^https?:\/\//, '')}
                          </button>
                          <CopyButton value={activeTunnel.publicUrl} label="Copy public URL" />
                          {appTunnels.length > 1 && (
                            <span className="text-[10px] text-muted-foreground">+{appTunnels.length - 1}</span>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Globe2 className="size-3" aria-hidden="true" />
                          {appTunnels.length} stopped
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant={running ? 'outline' : 'secondary'}
                          size="xs"
                          disabled={busy}
                          onClick={() => void (running ? stop(application) : start(application))}
                        >
                          {busy ? <Spinner /> : running ? <Square className="size-3" /> : <Play className="size-3" />}
                          {running ? 'Stop' : 'Start'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy}
                          aria-label={`View logs for ${application.name}`}
                          title="View logs"
                          onClick={() => setLogsFor(application)}
                        >
                          <Terminal aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Start & Expose"
                          aria-label={`Start and expose ${application.name}`}
                          disabled={busy}
                          onClick={() => void expose(application)}
                        >
                          <Globe2 aria-hidden="true" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" title="More actions">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {application.name}
                            </DropdownMenuLabel>
                            <DropdownMenuItem onSelect={() => void restart(application)} disabled={busy}>
                              <RotateCw />
                              Restart
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => openLocalUrl(application)}
                              disabled={!application.localUrl}
                            >
                              <ExternalLink />
                              Open local URL
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => openDirectory(application)}>
                              <FolderOpen />
                              Open project folder
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setLogsFor(application)}>
                              <Terminal />
                              View logs
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                setEditing(application)
                                setFormOpen(true)
                              }}
                            >
                              <Pencil />
                              Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void duplicate(application)} disabled={busy}>
                              <Copy />
                              Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-warning focus:text-warning"
                              onSelect={() => setStopTarget(application)}
                              disabled={application.pid === null && appTunnels.length === 0}
                            >
                              <Power />
                              Stop everything
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => setDeleteTarget(application)}
                            >
                              <Trash2 />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <ApplicationFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        application={editing}
        defaultDirectory={settings?.defaultWorkingDirectory ?? ''}
      />

      <LogSheet
        open={logsFor !== null}
        onOpenChange={(open) => (!open ? setLogsFor(null) : undefined)}
        source="application"
        applicationId={logsFor?.id}
        title={logsFor ? `${logsFor.name} logs` : 'Application logs'}
        subtitle={logsFor?.startCommand}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => (!open ? setDeleteTarget(null) : undefined)}
        title={`Delete "${deleteTarget?.name ?? ''}"?`}
        description="This stops the application and all of its tunnels, then removes it from Local App Manager. Files on disk are not touched."
        confirmLabel="Delete application"
        onConfirm={async () => {
          if (!deleteTarget) return
          await run(() => window.api.applications.remove(deleteTarget.id), {
            loading: 'Deleting application…',
            success: 'Application deleted',
            error: 'Could not delete application'
          })
          setDeleteTarget(null)
        }}
      />

      <ConfirmDialog
        open={stopTarget !== null}
        onOpenChange={(open) => (!open ? setStopTarget(null) : undefined)}
        title={`Stop everything for "${stopTarget?.name ?? ''}"?`}
        description="All tunnels for this application are stopped first, then the local process is terminated."
        confirmLabel="Stop everything"
        variant="default"
        onConfirm={async () => {
          if (!stopTarget) return
          await run(() => window.api.applications.stopEverything(stopTarget.id), {
            loading: 'Stopping tunnels and application…',
            success: 'Everything stopped',
            error: 'Could not stop everything'
          })
          setStopTarget(null)
        }}
      />

      <ConfirmDialog
        open={stopAllOpen}
        onOpenChange={setStopAllOpen}
        title="Stop all running applications?"
        description={`This will stop ${activeApps.length} running application(s). Active tunnels will not be deleted.`}
        confirmLabel="Stop all"
        onConfirm={async () => {
          await stopAll()
          setStopAllOpen(false)
        }}
      />
    </div>
  )
}
