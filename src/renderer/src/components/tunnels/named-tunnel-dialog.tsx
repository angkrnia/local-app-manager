import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Loader2,
  LogIn,
  Plus,
  RefreshCw
} from 'lucide-react'
import type { Application, NamedAuthStatus, NamedTunnelRemote } from '@shared/types'
import { errorMessage, unwrap } from '@/lib/api'
import { run, runAction } from '@/lib/run'
import { useExposure } from '@/components/shared/exposure-provider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'

export function NamedTunnelDialog({
  open,
  onOpenChange,
  applications
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  applications: Application[]
}): React.JSX.Element {
  const { ensureAccepted } = useExposure()
  const [auth, setAuth] = useState<NamedAuthStatus | null>(null)
  const [remotes, setRemotes] = useState<NamedTunnelRemote[]>([])
  const [loadingAuth, setLoadingAuth] = useState(false)
  const [loadingRemotes, setLoadingRemotes] = useState(false)
  const [tunnelName, setTunnelName] = useState('')
  const [newTunnelName, setNewTunnelName] = useState('')
  const [creatingRemote, setCreatingRemote] = useState(false)
  const [applicationId, setApplicationId] = useState('')
  const [hostname, setHostname] = useState('')
  const [routeDns, setRouteDns] = useState(true)
  const [startNow, setStartNow] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadRemotes = useCallback(async (): Promise<void> => {
    setLoadingRemotes(true)
    try {
      const list = await unwrap(window.api.named.listRemote())
      setRemotes(list)
      setTunnelName((current) => current || list[0]?.name || '')
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setLoadingRemotes(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setError(null)
    setApplicationId(applications[0]?.id ?? '')
    setHostname('')
    setTunnelName('')
    setNewTunnelName('')
    setRouteDns(true)
    setStartNow(true)
    setRemotes([])

    let cancelled = false
    setLoadingAuth(true)
    void unwrap(window.api.named.status())
      .then((status) => {
        if (cancelled) return
        setAuth(status)
        if (status.authenticated) void loadRemotes()
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorMessage(caught))
      })
      .finally(() => {
        if (!cancelled) setLoadingAuth(false)
      })

    return () => {
      cancelled = true
    }
    // Intentionally only resets when the dialog opens; live application updates
    // must not overwrite what the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loadRemotes])

  const signIn = async (): Promise<void> => {
    const status = await run(() => window.api.named.login(), {
      loading: 'Waiting for Cloudflare authorization…',
      success: 'Connected to Cloudflare',
      error: 'Cloudflare sign-in failed'
    })
    if (status) {
      setAuth(status)
      if (status.authenticated) await loadRemotes()
    }
  }

  const createRemote = async (): Promise<void> => {
    const name = newTunnelName.trim()
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name)) {
      setError('Tunnel name must use lowercase letters, numbers and hyphens.')
      return
    }
    setCreatingRemote(true)
    setError(null)
    const created = await run(() => window.api.named.createRemote({ name }), {
      loading: 'Creating tunnel in Cloudflare…',
      success: (remote) => `Tunnel "${remote.name}" created`,
      error: 'Could not create the Cloudflare tunnel'
    })
    setCreatingRemote(false)
    if (created) {
      setNewTunnelName('')
      await loadRemotes()
      setTunnelName(created.name)
    }
  }

  const selectedRemote = useMemo(
    () => remotes.find((remote) => remote.name === tunnelName) ?? null,
    [remotes, tunnelName]
  )

  const submit = async (): Promise<void> => {
    setError(null)
    if (!applicationId) return setError('Select an application.')
    if (!tunnelName) return setError('Select or create a Cloudflare tunnel.')
    if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname.trim())) {
      return setError('Enter a valid hostname, for example app.example.com.')
    }
    if (hostname.trim().toLowerCase().endsWith('.trycloudflare.com')) {
      return setError('trycloudflare.com hostnames are reserved for Quick Tunnels.')
    }
    if (startNow && !(await ensureAccepted())) return

    setBusy(true)
    try {
      if (routeDns) {
        const routed = await runAction(
          () =>
            window.api.named.routeDns({
              tunnelName,
              hostname: hostname.trim().toLowerCase()
            }),
          {
            loading: 'Creating the DNS route…',
            success: 'DNS route created',
            error: 'Could not create the DNS route'
          }
        )
        if (!routed) {
          setBusy(false)
          return
        }
      }

      const tunnel = await run(
        () =>
          window.api.tunnels.createNamed({
            applicationId,
            tunnelName,
            hostname: hostname.trim().toLowerCase(),
            startNow
          }),
        {
          loading: startNow ? 'Starting named tunnel…' : 'Saving named tunnel…',
          success: startNow ? 'Named tunnel is running' : 'Named tunnel added',
          error: 'Could not add the named tunnel'
        }
      )
      if (tunnel) onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!busy ? onOpenChange(next) : undefined)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="size-4 text-primary" />
            New Named Tunnel
          </DialogTitle>
          <DialogDescription>
            Named tunnels use your own Cloudflare domain and keep a stable URL. You need a Cloudflare account
            with a domain on Cloudflare.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  {auth?.authenticated ? (
                    <CheckCircle2 className="size-3.5 text-success" />
                  ) : (
                    <Cloud className="size-3.5 text-muted-foreground" />
                  )}
                  Cloudflare account
                </p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {loadingAuth
                    ? 'Checking authentication…'
                    : auth?.authenticated
                      ? `Authorized · ${auth.certPath}`
                      : 'Sign in to create named tunnels and DNS routes.'}
                </p>
              </div>
              {!auth?.authenticated && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={loadingAuth}
                  onClick={() => void signIn()}
                >
                  {loadingAuth ? <Loader2 className="animate-spin" /> : <LogIn />}
                  Sign in
                </Button>
              )}
            </div>
          </section>

          {auth?.authenticated && (
            <>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label>Cloudflare tunnel</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    disabled={loadingRemotes}
                    onClick={() => void loadRemotes()}
                  >
                    {loadingRemotes ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    Refresh
                  </Button>
                </div>
                {remotes.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-[11px] text-muted-foreground">
                    {loadingRemotes ? 'Loading tunnels…' : 'No named tunnels in your account yet. Create one below.'}
                  </p>
                ) : (
                  <Select value={tunnelName} onValueChange={setTunnelName}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a tunnel" />
                    </SelectTrigger>
                    <SelectContent>
                      {remotes.map((remote) => (
                        <SelectItem key={remote.id || remote.name} value={remote.name}>
                          {remote.name}
                          {remote.connections ? ` · ${remote.connections} connection(s)` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {selectedRemote && (
                  <p className="font-mono text-[10px] text-muted-foreground">ID {selectedRemote.id || 'unknown'}</p>
                )}
              </div>

              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Label htmlFor="new-tunnel-name">Create a new tunnel</Label>
                  <Input
                    id="new-tunnel-name"
                    value={newTunnelName}
                    onChange={(event) =>
                      setNewTunnelName(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                    }
                    placeholder="my-app-tunnel"
                    className="font-mono text-xs"
                    maxLength={63}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={creatingRemote || !newTunnelName.trim()}
                  onClick={() => void createRemote()}
                >
                  {creatingRemote ? <Loader2 className="animate-spin" /> : <Plus />}
                  Create
                </Button>
              </div>

              <Separator />

              <div className="space-y-1.5">
                <Label>Application</Label>
                <Select value={applicationId} onValueChange={setApplicationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an application" />
                  </SelectTrigger>
                  <SelectContent>
                    {applications.map((application) => (
                      <SelectItem key={application.id} value={application.id}>
                        {application.name}
                        {application.status === 'running' ? '' : ' (stopped)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="named-hostname">Public hostname</Label>
                <Input
                  id="named-hostname"
                  value={hostname}
                  onChange={(event) => setHostname(event.target.value.trim())}
                  placeholder="app.example.com"
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Must be a domain managed by the same Cloudflare account.
                </p>
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
                <Switch checked={routeDns} onCheckedChange={setRouteDns} />
                <span>
                  <span className="block text-xs font-medium">Create the DNS route automatically</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Runs <span className="font-mono">cloudflared tunnel route dns</span>. Disable if the CNAME
                    already exists.
                  </span>
                </span>
              </label>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border px-3 py-2.5">
                <Switch checked={startNow} onCheckedChange={setStartNow} />
                <span>
                  <span className="block text-xs font-medium">Start the tunnel after saving</span>
                  <span className="block text-[11px] text-muted-foreground">
                    The application must already be listening on its local port.
                  </span>
                </span>
              </label>
            </>
          )}

          {error && (
            <p className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={busy || !auth?.authenticated || applications.length === 0}
            onClick={() => void submit()}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Cloud />}
            {startNow ? 'Add & start' : 'Add tunnel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
