import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Cloud,
  ExternalLink,
  Globe2,
  Loader2,
  MoreHorizontal,
  Play,
  Power,
  RadioTower,
  RotateCw,
  Search,
  Square,
  Terminal,
  Trash2,
  Rocket,
  Link2,
  CheckSquare2
} from 'lucide-react'
import { toast } from 'sonner'
import type { BatchResult, NamedAuthStatus, Tunnel, TunnelType } from '@shared/types'
import { run } from '@/lib/run'
import { cn, formatRelative, formatUptime } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { useTicker } from '@/hooks/use-ticker'
import { useExposure } from '@/components/shared/exposure-provider'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { CopyButton } from '@/components/shared/copy-button'
import { Spinner } from '@/components/shared/spinner'
import { LogSheet } from '@/components/shared/log-sheet'
import { CloudflaredBanner } from '@/components/shared/cloudflared-banner'
import { QuickTunnelDialog } from '@/components/tunnels/quick-tunnel-dialog'
import { NamedTunnelDialog } from '@/components/tunnels/named-tunnel-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
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

function tunnelLabel(tunnel: Tunnel): string {
  if (tunnel.tunnelName) return tunnel.tunnelName
  return tunnel.tunnelType === 'named' ? 'Named tunnel' : 'Quick tunnel'
}

function batchMessage(result: BatchResult, verb: string): string {
  if (result.failed.length === 0) {
    return `${result.succeeded.length} tunnel${result.succeeded.length === 1 ? '' : 's'} ${verb}`
  }
  return `${result.succeeded.length} ${verb}, ${result.failed.length} failed`
}

export default function TunnelsPage(): React.JSX.Element {
  const tunnels = useAppStore((state) => state.tunnels)
  const applications = useAppStore((state) => state.applications)
  const { ensureAccepted } = useExposure()
  const [searchParams, setSearchParams] = useSearchParams()

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | TunnelType>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [quickOpen, setQuickOpen] = useState(false)
  const [namedOpen, setNamedOpen] = useState(false)
  const [logsFor, setLogsFor] = useState<Tunnel | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Tunnel | null>(null)
  const [stopAllOpen, setStopAllOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [batching, setBatching] = useState(false)
  const [namedStatus, setNamedStatus] = useState<NamedAuthStatus | null>(null)
  const [connecting, setConnecting] = useState(false)
  useTicker(5_000)

  useEffect(() => {
    void window.api.named
      .status()
      .then((result) => {
        if (result.ok) setNamedStatus(result.data)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const requested = searchParams.get('new')
    if (requested === 'quick') setQuickOpen(true)
    if (requested === 'named') setNamedOpen(true)
    if (requested) {
      const next = new URLSearchParams(searchParams)
      next.delete('new')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    setSelected((current) => {
      const ids = new Set(tunnels.map((tunnel) => tunnel.id))
      const next = new Set([...current].filter((id) => ids.has(id)))
      return next.size === current.size ? current : next
    })
  }, [tunnels])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return tunnels.filter((tunnel) => {
      if (typeFilter !== 'all' && tunnel.tunnelType !== typeFilter) return false
      if (statusFilter !== 'all' && tunnel.status !== statusFilter) return false
      if (term) {
        const haystack = [tunnel.tunnelName, tunnel.applicationName, tunnel.publicUrl, tunnel.localUrl]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
  }, [tunnels, search, typeFilter, statusFilter])

  const allVisibleSelected = filtered.length > 0 && filtered.every((tunnel) => selected.has(tunnel.id))
  const runningCount = tunnels.filter((tunnel) => tunnel.status === 'running').length

  const toggleSelected = (id: string, checked: boolean): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleAll = (checked: boolean): void => {
    setSelected(checked ? new Set(filtered.map((tunnel) => tunnel.id)) : new Set())
  }

  const connectCloudflare = async (): Promise<void> => {
    setConnecting(true)
    const status = await run(() => window.api.named.login(), {
      loading: 'Waiting for Cloudflare authorization…',
      success: 'Connected to Cloudflare',
      error: 'Cloudflare sign-in failed'
    })
    if (status) setNamedStatus(status)
    setConnecting(false)
  }

  const start = async (tunnel: Tunnel): Promise<void> => {
    if (!(await ensureAccepted())) return
    setBusyId(tunnel.id)
    await run(() => window.api.tunnels.start(tunnel.id), {
      loading: 'Starting tunnel…',
      success: 'Tunnel is running',
      error: 'Could not start tunnel'
    })
    setBusyId(null)
  }

  const stop = async (tunnel: Tunnel): Promise<void> => {
    setBusyId(tunnel.id)
    await run(() => window.api.tunnels.stop(tunnel.id), {
      loading: 'Stopping tunnel…',
      success: 'Tunnel stopped',
      error: 'Could not stop tunnel'
    })
    setBusyId(null)
  }

  const restart = async (tunnel: Tunnel): Promise<void> => {
    if (!(await ensureAccepted())) return
    setBusyId(tunnel.id)
    await run(() => window.api.tunnels.restart(tunnel.id), {
      loading: 'Restarting tunnel…',
      success: 'Tunnel restarted',
      error: 'Could not restart tunnel'
    })
    setBusyId(null)
  }

  const openPublicUrl = (tunnel: Tunnel): void => {
    void run(() => window.api.tunnels.openPublicUrl(tunnel.id), {
      error: 'Could not open the public URL'
    })
  }

  const runBatch = async (kind: 'start' | 'stop' | 'restart'): Promise<void> => {
    const ids = [...selected]
    if (ids.length === 0) return
    if (kind !== 'stop' && !(await ensureAccepted())) return

    setBatching(true)
    const action =
      kind === 'start'
        ? () => window.api.tunnels.startMany(ids)
        : kind === 'stop'
          ? () => window.api.tunnels.stopMany(ids)
          : () => window.api.tunnels.restartMany(ids)

    const verb = kind === 'start' ? 'started' : kind === 'stop' ? 'stopped' : 'restarted'
    const result = await run(action, {
      loading: `${kind === 'start' ? 'Starting' : kind === 'stop' ? 'Stopping' : 'Restarting'} ${ids.length} tunnel${ids.length === 1 ? '' : 's'}…`,
      success: (data) => batchMessage(data, verb),
      error: 'Batch action failed'
    })
    if (result && result.failed.length > 0) {
      toast.warning(`${result.failed.length} tunnel${result.failed.length === 1 ? '' : 's'} failed`, {
        description: result.failed[0]?.error
      })
    }
    setBatching(false)
    setSelected(new Set())
  }

  const startAll = async (): Promise<void> => {
    if (!(await ensureAccepted())) return
    setBatching(true)
    const result = await run(() => window.api.tunnels.startAll(), {
      loading: 'Starting all tunnels…',
      success: (data) => batchMessage(data, 'started'),
      error: 'Could not start all tunnels'
    })
    if (result && result.failed.length > 0) {
      toast.warning(`${result.failed.length} tunnel${result.failed.length === 1 ? '' : 's'} failed`, {
        description: result.failed[0]?.error
      })
    }
    setBatching(false)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tunnels"
        description="Quick Tunnels for instant temporary URLs, named tunnels for your own domain."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setQuickOpen(true)}>
              <Rocket />
              Quick tunnel
            </Button>
            <Button size="sm" onClick={() => setNamedOpen(true)}>
              <Cloud />
              Named tunnel
            </Button>
          </>
        }
      />

      <CloudflaredBanner />

      {namedStatus && !namedStatus.authenticated && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="rounded-md border border-border bg-muted/50 p-1.5 text-muted-foreground">
              <Cloud className="size-4" />
            </span>
            <div>
              <p className="text-sm font-medium">Connect Cloudflare for named tunnels</p>
              <p className="text-xs text-muted-foreground">
                Quick tunnels work without an account. Named tunnels need a one-time browser sign-in.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" disabled={connecting} onClick={() => void connectCloudflare()}>
            {connecting ? <Loader2 className="animate-spin" /> : <Cloud />}
            Sign in to Cloudflare
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search tunnels…"
            className="h-9 pl-8 text-sm"
          />
        </div>
        <Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as 'all' | TunnelType)}>
          <SelectTrigger className="h-9 w-36 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="quick">Quick</SelectItem>
            <SelectItem value="named">Named</SelectItem>
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

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {runningCount} running · {tunnels.length} total
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={batching || tunnels.length === 0}
            onClick={() => void startAll()}
          >
            {batching ? <Spinner /> : <Play />}
            Start all
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={batching || runningCount === 0}
            onClick={() => setStopAllOpen(true)}
          >
            <Square />
            Stop all
          </Button>
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-primary/[0.06] px-3 py-2">
          <CheckSquare2 className="size-4 text-primary" />
          <span className="text-xs font-medium">
            {selected.size} selected
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <Button size="xs" variant="outline" disabled={batching} onClick={() => void runBatch('start')}>
              <Play />
              Start
            </Button>
            <Button size="xs" variant="outline" disabled={batching} onClick={() => void runBatch('restart')}>
              <RotateCw />
              Restart
            </Button>
            <Button size="xs" variant="outline" disabled={batching} onClick={() => void runBatch('stop')}>
              <Square />
              Stop
            </Button>
            <Button size="xs" variant="ghost" disabled={batching} onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        {tunnels.length === 0 ? (
          <EmptyState
            icon={RadioTower}
            title="No tunnels yet"
            description="Create a Quick Tunnel to get a temporary public URL, or use a named tunnel with your own domain."
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => setQuickOpen(true)}>
                  <Rocket />
                  Create Quick Tunnel
                </Button>
                <Button size="sm" variant="outline" onClick={() => setNamedOpen(true)}>
                  <Cloud />
                  Named tunnel
                </Button>
              </div>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No tunnels match"
            description="Try a different search term or clear the filters."
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSearch('')
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
                <TableHead className="w-10">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={(checked) => toggleAll(checked === true)}
                    aria-label="Select all visible tunnels"
                  />
                </TableHead>
                <TableHead>Tunnel</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Public URL</TableHead>
                <TableHead>Local target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Uptime</TableHead>
                <TableHead className="w-12 text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((tunnel) => {
                const busy = busyId === tunnel.id
                const running = tunnel.status === 'running'
                return (
                  <TableRow key={tunnel.id} data-state={selected.has(tunnel.id) ? 'selected' : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(tunnel.id)}
                        onCheckedChange={(checked) => toggleSelected(tunnel.id, checked === true)}
                        aria-label={`Select ${tunnelLabel(tunnel)}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{tunnelLabel(tunnel)}</p>
                        <p className="truncate text-[11px] text-muted-foreground">
                          {tunnel.applicationName ?? 'No application'}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
                          tunnel.tunnelType === 'named'
                            ? 'border-primary/25 bg-primary/10 text-primary'
                            : 'border-border bg-muted/40 text-muted-foreground'
                        )}
                      >
                        {tunnel.tunnelType === 'named' ? <Cloud className="size-2.5" /> : <Rocket className="size-2.5" />}
                        {tunnel.tunnelType === 'named' ? 'Named' : 'Quick'}
                      </span>
                    </TableCell>
                    <TableCell>
                      {tunnel.publicUrl ? (
                        <div className="flex items-center gap-0.5">
                          {running ? (
                            <button
                              type="button"
                              onClick={() => openPublicUrl(tunnel)}
                              className="max-w-[220px] truncate font-mono text-[11px] text-primary hover:underline"
                              title={tunnel.publicUrl}
                            >
                              {tunnel.publicUrl.replace(/^https?:\/\//, '')}
                            </button>
                          ) : (
                            <span
                              className="max-w-[220px] truncate font-mono text-[11px] text-muted-foreground"
                              title={tunnel.publicUrl}
                            >
                              {tunnel.publicUrl.replace(/^https?:\/\//, '')}
                            </span>
                          )}
                          <CopyButton value={tunnel.publicUrl} label="Copy public URL" toastOnCopy={false} />
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {running ? 'Waiting for URL…' : '—'}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-[11px] text-muted-foreground">{tunnel.localUrl}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={tunnel.status} />
                        {tunnel.lastError && tunnel.status === 'error' && (
                          <span
                            className="max-w-[180px] truncate text-[10px] text-destructive"
                            title={tunnel.lastError}
                          >
                            {tunnel.lastError}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {running ? formatUptime(tunnel.startedAt) : formatRelative(tunnel.updatedAt)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy}
                          title={running ? 'Stop' : 'Start'}
                          onClick={() => void (running ? stop(tunnel) : start(tunnel))}
                        >
                          {busy ? <Spinner /> : running ? <Square /> : <Play />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Restart"
                          disabled={busy}
                          onClick={() => void restart(tunnel)}
                        >
                          <RotateCw />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" title="More actions">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                              {tunnelLabel(tunnel)}
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              disabled={!running || !tunnel.publicUrl}
                              onSelect={() => openPublicUrl(tunnel)}
                            >
                              <ExternalLink />
                              Open public URL
                            </DropdownMenuItem>
                            {tunnel.publicUrl && (
                              <DropdownMenuItem
                                onSelect={() => {
                                  void navigator.clipboard
                                    .writeText(tunnel.publicUrl as string)
                                    .then(() => toast.success('Public URL copied'))
                                    .catch(() => toast.error('Could not copy the URL'))
                                }}
                              >
                                <Link2 />
                                Copy public URL
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onSelect={() => setLogsFor(tunnel)}>
                              <Terminal />
                              View tunnel logs
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => {
                                if (tunnel.applicationId) {
                                  const app = applications.find((item) => item.id === tunnel.applicationId)
                                  if (app) toast.info(`${app.name} · ${app.localUrl}`)
                                }
                              }}
                              disabled={!tunnel.applicationId}
                            >
                              <Globe2 />
                              Local target details
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onSelect={() => setDeleteTarget(tunnel)}
                            >
                              <Trash2 />
                              Delete tunnel
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

      <QuickTunnelDialog
        open={quickOpen}
        onOpenChange={setQuickOpen}
        applications={applications}
      />
      <NamedTunnelDialog open={namedOpen} onOpenChange={setNamedOpen} applications={applications} />

      <LogSheet
        open={logsFor !== null}
        onOpenChange={(open) => (!open ? setLogsFor(null) : undefined)}
        source="tunnel"
        tunnelId={logsFor?.id}
        title={logsFor ? `${tunnelLabel(logsFor)} logs` : 'Tunnel logs'}
        subtitle={logsFor?.publicUrl ?? logsFor?.localUrl}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => (!open ? setDeleteTarget(null) : undefined)}
        title={`Delete "${deleteTarget ? tunnelLabel(deleteTarget) : ''}"?`}
        description="The tunnel is stopped and removed from Local App Manager. The Cloudflare named tunnel itself is not deleted from your account."
        confirmLabel="Delete tunnel"
        onConfirm={async () => {
          if (!deleteTarget) return
          await run(() => window.api.tunnels.remove(deleteTarget.id), {
            loading: 'Deleting tunnel…',
            success: 'Tunnel deleted',
            error: 'Could not delete tunnel'
          })
          setDeleteTarget(null)
        }}
      />

      <ConfirmDialog
        open={stopAllOpen}
        onOpenChange={setStopAllOpen}
        title="Stop all tunnels?"
        description="Every public URL will go offline immediately. Applications keep running."
        confirmLabel="Stop all tunnels"
        variant="default"
        onConfirm={async () => {
          const result = await run(() => window.api.tunnels.stopAll(), {
            loading: 'Stopping all tunnels…',
            success: (data) => batchMessage(data, 'stopped'),
            error: 'Could not stop all tunnels'
          })
          if (result && result.failed.length > 0) {
            toast.warning(`${result.failed.length} tunnel${result.failed.length === 1 ? '' : 's'} failed to stop`, {
              description: result.failed[0]?.error
            })
          }
          setStopAllOpen(false)
        }}
      />

      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Power className="size-3" />
        <span>
          Stopping a tunnel closes its public route. Quick Tunnel URLs cannot be reused after a restart.
        </span>
      </div>
    </div>
  )
}
