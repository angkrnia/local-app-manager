import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Plug,
  RefreshCw,
  Search,
  ShieldAlert,
  Skull,
  XCircle
} from 'lucide-react'
import type { ListeningPort } from '@shared/types'
import { run } from '@/lib/run'
import { useAppStore } from '@/stores/app-store'
import { PageHeader } from '@/components/shared/page-header'
import { EmptyState } from '@/components/shared/empty-state'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Spinner } from '@/components/shared/spinner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'

export default function PortsPage(): React.JSX.Element {
  const applications = useAppStore((state) => state.applications)
  const [ports, setPorts] = useState<ListeningPort[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showSystem, setShowSystem] = useState(false)

  const [checkInput, setCheckInput] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkedResult, setCheckedResult] = useState<{
    port: number
    entry: ListeningPort | null
  } | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)

  const [killTarget, setKillTarget] = useState<ListeningPort | null>(null)
  const [killingPort, setKillingPort] = useState<number | null>(null)

  const loadPorts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    const list = await run(() => window.api.ports.list(), {
      error: 'Could not scan listening ports'
    })
    if (list) setPorts(list)
    setLoading(false)
  }, [])

  useEffect(() => {
    void loadPorts()
  }, [loadPorts])

  const appByPort = useMemo(() => {
    const map = new Map<number, string>()
    for (const app of applications) {
      if (app.localPort !== null) map.set(app.localPort, app.name)
      if (app.detectedPort !== null) map.set(app.detectedPort, app.name)
    }
    return map
  }, [applications])

  const visiblePorts = useMemo(() => {
    const term = search.trim().toLowerCase()
    return ports.filter((item) => {
      if (!showSystem && item.isSystem) return false
      if (!term) return true
      const appName = appByPort.get(item.port)?.toLowerCase() ?? ''
      return (
        String(item.port).includes(term) ||
        item.processName.toLowerCase().includes(term) ||
        String(item.pid).includes(term) ||
        appName.includes(term)
      )
    })
  }, [ports, showSystem, search, appByPort])

  const handleCheckPort = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setCheckError(null)
    const parsed = Number(checkInput.trim())
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
      setCheckError('Enter a valid port number between 1 and 65535.')
      return
    }
    setChecking(true)
    const result = await run(() => window.api.ports.check(parsed), {
      error: `Could not check port ${parsed}`
    })
    setChecking(false)
    setCheckedResult({ port: parsed, entry: result })
  }

  const handleKill = async (target: ListeningPort): Promise<void> => {
    setKillingPort(target.port)
    const killed = await run(() => window.api.ports.kill(target.port), {
      loading: `Stopping ${target.processName} on port ${target.port}...`,
      success: (res) => `Freed port ${res.port} (killed ${res.processName}, PID ${res.pid})`,
      error: `Could not kill process on port ${target.port}`
    })
    setKillingPort(null)
    if (killed) {
      if (checkedResult?.port === target.port) {
        setCheckedResult({ port: target.port, entry: null })
      }
      await loadPorts(true)
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Ports"
        description="Inspect active TCP ports on this machine and terminate stuck processes."
        actions={
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void loadPorts()}>
            {loading ? <Spinner /> : <RefreshCw />}
            Refresh
          </Button>
        }
      />

      {/* Quick port check & kill */}
      <Card>
        <CardContent className="space-y-3 p-4">
          <form onSubmit={(event) => void handleCheckPort(event)} className="flex flex-wrap items-center gap-2">
            <Input
              type="number"
              min={1}
              max={65535}
              value={checkInput}
              onChange={(event) => setCheckInput(event.target.value)}
              placeholder="Check specific port (e.g. 3000, 5173, 8000)"
              className="h-9 max-w-xs font-mono text-sm"
            />
            <Button type="submit" size="sm" disabled={checking || !checkInput.trim()}>
              {checking ? <Spinner /> : <Search />}
              Check port
            </Button>

            {checkedResult && (
              <div className="ml-auto flex flex-wrap items-center gap-2.5 text-xs">
                {checkedResult.entry ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-destructive">
                      <XCircle className="size-3.5" aria-hidden="true" />
                      Port <span className="font-mono font-semibold">{checkedResult.port}</span> is in use by{' '}
                      <span className="font-mono font-medium text-foreground">
                        {checkedResult.entry.processName}
                      </span>{' '}
                      (PID {checkedResult.entry.pid})
                    </span>
                    <Button
                      type="button"
                      variant="destructive"
                      size="xs"
                      disabled={checkedResult.entry.isSystem || killingPort === checkedResult.port}
                      onClick={() => setKillTarget(checkedResult.entry)}
                    >
                      {killingPort === checkedResult.port ? <Spinner /> : <Skull className="size-3" />}
                      Kill process
                    </Button>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-success">
                    <CheckCircle2 className="size-3.5" aria-hidden="true" />
                    Port <span className="font-mono font-semibold">{checkedResult.port}</span> is available
                  </span>
                )}
              </div>
            )}
          </form>

          {checkError && <p className="text-xs text-destructive">{checkError}</p>}
        </CardContent>
      </Card>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Filter by port, process, PID, or app..."
            className="h-9 pl-8 text-sm"
          />
        </div>

        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={showSystem} onCheckedChange={setShowSystem} />
          Show Windows system ports
        </label>

        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {visiblePorts.length} port(s)
        </span>
      </div>

      {/* Listening ports table */}
      <Card className="overflow-hidden">
        {loading && ports.length === 0 ? (
          <div className="flex min-h-[220px] items-center justify-center gap-2 text-xs text-muted-foreground">
            <Spinner />
            Scanning active TCP ports...
          </div>
        ) : visiblePorts.length === 0 ? (
          <EmptyState
            icon={Plug}
            title="No matching listening ports"
            description={
              search
                ? 'Try clearing your search term or enable system ports.'
                : 'No user processes are currently listening on TCP ports.'
            }
            action={
              search ? (
                <Button size="sm" variant="outline" onClick={() => setSearch('')}>
                  Clear filter
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Port</TableHead>
                <TableHead>Process</TableHead>
                <TableHead className="w-28">PID</TableHead>
                <TableHead className="w-40">Address</TableHead>
                <TableHead className="w-28 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiblePorts.map((item) => {
                const appName = appByPort.get(item.port)
                const busy = killingPort === item.port
                return (
                  <TableRow key={`${item.port}-${item.pid}`}>
                    <TableCell>
                      <span className="font-mono text-sm font-semibold text-foreground">
                        :{item.port}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-foreground">{item.processName}</span>
                        {appName && <Badge variant="outline">{appName}</Badge>}
                        {item.isSystem && (
                          <Badge variant="secondary" className="gap-1">
                            <ShieldAlert className="size-3" aria-hidden="true" />
                            Protected
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {item.pid}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">
                        {item.localAddress}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="xs"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={item.isSystem || busy}
                        title={
                          item.isSystem
                            ? 'Protected system process cannot be terminated here'
                            : `Kill ${item.processName} (PID ${item.pid})`
                        }
                        onClick={() => setKillTarget(item)}
                      >
                        {busy ? <Spinner /> : <Skull className="size-3" aria-hidden="true" />}
                        Kill
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(killTarget)}
        onOpenChange={(open) => {
          if (!open) setKillTarget(null)
        }}
        title={killTarget ? `Kill process on port ${killTarget.port}?` : 'Kill process?'}
        description={
          killTarget
            ? `This will force-stop "${killTarget.processName}" (PID ${killTarget.pid}) and its child processes. Unsaved work in that process may be lost.`
            : ''
        }
        confirmLabel="Kill process"
        variant="destructive"
        onConfirm={async () => {
          if (!killTarget) return
          const target = killTarget
          setKillTarget(null)
          await handleKill(target)
        }}
      />
    </div>
  )
}
