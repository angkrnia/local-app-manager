import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  Boxes,
  ExternalLink,
  Globe2,
  Play,
  Plus,
  Power,
  Rocket,
  Square
} from 'lucide-react'
import type { Application, Tunnel } from '@shared/types'
import { applicationTypeLabel } from '@/lib/labels'
import { run } from '@/lib/run'
import { cn, formatRelative, formatUptime } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { useTicker } from '@/hooks/use-ticker'
import { useExposure } from '@/components/shared/exposure-provider'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { CopyButton } from '@/components/shared/copy-button'
import { CloudflaredBanner } from '@/components/shared/cloudflared-banner'
import { WorkflowProgressPanel } from '@/components/shared/workflow-progress'
import { Spinner } from '@/components/shared/spinner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'

export default function DashboardPage(): React.JSX.Element {
  const applications = useAppStore((state) => state.applications)
  const tunnels = useAppStore((state) => state.tunnels)
  const activity = useAppStore((state) => state.activity)
  const cloudflared = useAppStore((state) => state.cloudflared)
  const navigate = useNavigate()
  const { ensureAccepted } = useExposure()
  const [busyId, setBusyId] = useState<string | null>(null)
  useTicker(5_000)

  const runningApps = applications.filter((application) => application.status === 'running')
  const runningTunnels = tunnels.filter((tunnel) => tunnel.status === 'running')
  const unhealthy = applications.filter((application) => application.health === 'unhealthy')

  const recentApplications = useMemo(
    () =>
      [...applications]
        .sort((a, b) => {
          const rank = (application: Application): number =>
            application.status === 'running' ? 0 : application.status === 'error' ? 1 : 2
          return rank(a) - rank(b) || a.name.localeCompare(b.name)
        })
        .slice(0, 5),
    [applications]
  )

  const toggleApplication = async (application: Application): Promise<void> => {
    const starting = application.status !== 'running'
    setBusyId(application.id)
    await run(
      () =>
        starting
          ? window.api.applications.start(application.id)
          : window.api.applications.stop(application.id),
      {
        loading: starting ? `Starting ${application.name}…` : `Stopping ${application.name}…`,
        success: starting ? `${application.name} started` : `${application.name} stopped`,
        error: starting ? 'Could not start application' : 'Could not stop application'
      }
    )
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

  const stopTunnel = async (tunnel: Tunnel): Promise<void> => {
    setBusyId(tunnel.id)
    await run(() => window.api.tunnels.stop(tunnel.id), {
      loading: 'Stopping tunnel…',
      success: 'Tunnel stopped',
      error: 'Could not stop tunnel'
    })
    setBusyId(null)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Run your local applications and expose them through Cloudflare Tunnel."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/applications?new=1')}>
              <Plus />
              Add application
            </Button>
            <Button size="sm" onClick={() => navigate('/tunnels?new=quick')}>
              <Rocket />
              New tunnel
            </Button>
          </>
        }
      />

      <CloudflaredBanner />
      <WorkflowProgressPanel />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-border bg-card px-4 py-3 text-xs">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'size-2 rounded-full',
              runningApps.length > 0 ? 'bg-success' : 'bg-muted-foreground/40'
            )}
          />
          <span className="text-muted-foreground">Applications:</span>
          <span className="font-semibold tabular-nums text-foreground">
            {runningApps.length} / {applications.length} running
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              'size-2 rounded-full',
              runningTunnels.length > 0 ? 'bg-primary' : 'bg-muted-foreground/40'
            )}
          />
          <span className="text-muted-foreground">Tunnels:</span>
          <span className="font-semibold tabular-nums text-foreground">
            {runningTunnels.length} / {tunnels.length} live
          </span>
        </div>

        {unhealthy.length > 0 && (
          <div className="flex items-center gap-2 text-destructive">
            <span className="size-2 rounded-full bg-destructive" />
            <span className="font-semibold tabular-nums">{unhealthy.length} unhealthy</span>
          </div>
        )}

        <div className="ml-auto flex items-center gap-2 text-muted-foreground">
          <span>cloudflared:</span>
          <span className="font-mono font-medium text-foreground">
            {cloudflared?.available ? `v${cloudflared.version ?? 'ready'}` : cloudflared ? 'Missing' : 'Checking...'}
          </span>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Applications</CardTitle>
              <p className="text-xs text-muted-foreground">Start an app, then expose it with one click.</p>
            </div>
            <Button asChild variant="ghost" size="xs">
              <Link to="/applications">
                View all
                <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {recentApplications.length === 0 ? (
              <EmptyState
                icon={Boxes}
                title="No applications yet"
                description="Add a local project and Local App Manager will run it and create a public URL for you."
                action={
                  <Button size="sm" onClick={() => navigate('/applications?new=1')}>
                    <Plus />
                    Add application
                  </Button>
                }
              />
            ) : (
              <div className="divide-y divide-border/70">
                {recentApplications.map((application) => {
                  const busy = busyId === application.id
                  const running = application.status === 'running'
                  const exposed = runningTunnels.some((tunnel) => tunnel.applicationId === application.id)
                  return (
                    <div
                      key={application.id}
                      className="flex flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{application.name}</span>
                          <StatusBadge status={application.status} health={application.health} />
                          {exposed && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              <Globe2 className="size-2.5" />
                              Public
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                          <span>{applicationTypeLabel(application.applicationType)}</span>
                          <span aria-hidden>·</span>
                          <span className="font-mono">
                            {application.localUrl ??
                              (application.status === 'starting' ? 'Detecting port…' : 'Auto port')}
                          </span>
                          {application.pid !== null && (
                            <>
                              <span aria-hidden>·</span>
                              <span>PID {application.pid}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          variant="outline"
                          size="xs"
                          disabled={busy || application.status === 'starting' || application.status === 'stopping'}
                          onClick={() => void toggleApplication(application)}
                        >
                          {busy ? <Spinner className="size-3" /> : running ? <Square /> : <Play />}
                          {running ? 'Stop' : 'Start'}
                        </Button>
                        <Button
                          variant={exposed ? 'secondary' : 'default'}
                          size="xs"
                          disabled={busy || exposed}
                          onClick={() => void expose(application)}
                          title={exposed ? 'This application already has a running tunnel' : 'Start and expose'}
                        >
                          <Globe2 />
                          {exposed ? 'Exposed' : 'Expose'}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle>Active tunnels</CardTitle>
              <p className="text-xs text-muted-foreground">Public URLs currently online.</p>
            </div>
            <Button asChild variant="ghost" size="xs">
              <Link to="/tunnels">
                Manage
                <ArrowRight />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="flex-1 p-0">
            {runningTunnels.length === 0 ? (
              <EmptyState
                icon={Globe2}
                title="Nothing exposed"
                description="Create a Quick Tunnel to get a temporary public URL in seconds."
                action={
                  <Button size="sm" variant="outline" onClick={() => navigate('/tunnels?new=quick')}>
                    <Rocket />
                    Create tunnel
                  </Button>
                }
              />
            ) : (
              <ScrollArea className="max-h-[320px]">
                <div className="divide-y divide-border/70">
                  {runningTunnels.map((tunnel) => (
                    <div key={tunnel.id} className="space-y-2 px-5 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">
                          {tunnel.applicationName ?? tunnel.tunnelName ?? 'Tunnel'}
                        </span>
                        <StatusBadge status={tunnel.status} />
                      </div>
                      {tunnel.publicUrl && (
                        <div className="flex items-center gap-1">
                          <a
                            href={tunnel.publicUrl}
                            onClick={(event) => {
                              event.preventDefault()
                              void run(() => window.api.tunnels.openPublicUrl(tunnel.id), {
                                error: 'Could not open public URL'
                              })
                            }}
                            className="min-w-0 flex-1 truncate font-mono text-[11px] text-primary hover:underline"
                          >
                            {tunnel.publicUrl.replace(/^https?:\/\//, '')}
                          </a>
                          <CopyButton value={tunnel.publicUrl} label="Copy public URL" />
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            title="Open public URL"
                            onClick={() =>
                              void run(() => window.api.tunnels.openPublicUrl(tunnel.id), {
                                error: 'Could not open public URL'
                              })
                            }
                          >
                            <ExternalLink />
                          </Button>
                        </div>
                      )}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-muted-foreground">
                          {tunnel.tunnelType === 'named' ? 'Named' : 'Quick'} · up {formatUptime(tunnel.startedAt)}
                        </span>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="text-destructive hover:text-destructive"
                          disabled={busyId === tunnel.id}
                          onClick={() => void stopTunnel(tunnel)}
                        >
                          {busyId === tunnel.id ? <Spinner className="size-3" /> : <Power />}
                          Stop
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Recent activity</CardTitle>
            <p className="text-xs text-muted-foreground">Lifecycle events from applications and tunnels.</p>
          </div>
          <Button asChild variant="ghost" size="xs">
            <Link to="/activity">
              Open log
              <ArrowRight />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {activity.length === 0 ? (
            <EmptyState
              icon={Activity}
              title="No activity yet"
              description="Actions you take will be recorded here with timestamps."
            />
          ) : (
            <div className="divide-y divide-border/60">
              {activity.slice(0, 6).map((entry) => (
                <div key={entry.id} className="flex items-start gap-3 px-5 py-2.5">
                  <span
                    className={cn(
                      'mt-1.5 size-1.5 shrink-0 rounded-full',
                      entry.level === 'error'
                        ? 'bg-destructive'
                        : entry.level === 'warn'
                          ? 'bg-warning'
                          : 'bg-muted-foreground/50'
                    )}
                  />
                  <p className="min-w-0 flex-1 text-xs text-foreground/90">{entry.message}</p>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatRelative(entry.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
