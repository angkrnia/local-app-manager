import { useEffect, useState } from 'react'
import {
  ArrowDownToLine,
  CheckCircle2,
  CloudDownload,
  ExternalLink,
  FolderOpen,
  Info,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  Terminal,
  Wrench
} from 'lucide-react'
import type { AppSettings, LocalProtocol, SettingsPatch, ThemeMode, TunnelType } from '@shared/types'
import { run } from '@/lib/run'
import { cn, formatDateTime } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { PageHeader } from '@/components/shared/page-header'
import { LogViewer } from '@/components/shared/log-viewer'
import { Spinner } from '@/components/shared/spinner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange
}: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <div className="space-y-0.5">
        <Label htmlFor={id} className="text-sm font-medium text-foreground">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        className="mt-0.5 shrink-0"
      />
    </div>
  )
}

export default function SettingsPage(): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const setSettings = useAppStore((state) => state.setSettings)
  const cloudflared = useAppStore((state) => state.cloudflared)
  const setCloudflared = useAppStore((state) => state.setCloudflared)
  const downloadProgress = useAppStore((state) => state.downloadProgress)
  const systemInfo = useAppStore((state) => state.systemInfo)
  const updater = useAppStore((state) => state.updater)
  const setUpdater = useAppStore((state) => state.setUpdater)

  const [draft, setDraft] = useState<AppSettings | null>(settings)
  const [saving, setSaving] = useState(false)
  const [busyBinary, setBusyBinary] = useState<string | null>(null)
  const [busyUpdater, setBusyUpdater] = useState<'check' | 'download' | 'install' | null>(null)

  useEffect(() => {
    if (settings) setDraft(settings)
  }, [settings])

  const patchImmediate = async (patch: SettingsPatch, successMessage?: string): Promise<void> => {
    const updated = await run(() => window.api.settings.update(patch), {
      success: successMessage,
      error: 'Could not update setting'
    })
    if (updated) {
      setSettings(updated)
      setDraft(updated)
    }
  }

  const hasChanges =
    draft !== null &&
    settings !== null &&
    (draft.defaultWorkingDirectory !== settings.defaultWorkingDirectory ||
      draft.cloudflaredPath !== settings.cloudflaredPath ||
      draft.tunnelStartupTimeoutMs !== settings.tunnelStartupTimeoutMs ||
      draft.appStartupTimeoutMs !== settings.appStartupTimeoutMs ||
      draft.healthCheckIntervalMs !== settings.healthCheckIntervalMs ||
      draft.processTerminationTimeoutMs !== settings.processTerminationTimeoutMs ||
      draft.maxLogEntries !== settings.maxLogEntries ||
      draft.logDirectory !== settings.logDirectory ||
      draft.logRetentionDays !== settings.logRetentionDays)

  const saveNumericAndPaths = async (): Promise<void> => {
    if (!draft) return
    setSaving(true)
    try {
      const patch: SettingsPatch = {
        defaultWorkingDirectory: draft.defaultWorkingDirectory.trim(),
        cloudflaredPath: draft.cloudflaredPath.trim(),
        tunnelStartupTimeoutMs: Math.min(600_000, Math.max(15_000, Math.round(draft.tunnelStartupTimeoutMs))),
        appStartupTimeoutMs: Math.min(600_000, Math.max(10_000, Math.round(draft.appStartupTimeoutMs))),
        healthCheckIntervalMs: Math.min(300_000, Math.max(5_000, Math.round(draft.healthCheckIntervalMs))),
        processTerminationTimeoutMs: Math.min(
          60_000,
          Math.max(1_000, Math.round(draft.processTerminationTimeoutMs))
        ),
        maxLogEntries: Math.min(50_000, Math.max(100, Math.round(draft.maxLogEntries))),
        logDirectory: draft.logDirectory.trim(),
        logRetentionDays: Math.min(365, Math.max(1, Math.round(draft.logRetentionDays)))
      }
      const updated = await run(() => window.api.settings.update(patch), {
        success: 'Settings saved',
        error: 'Could not save settings'
      })
      if (updated) {
        setSettings(updated)
        setDraft(updated)
        const refreshed = await run(() => window.api.cloudflared.status())
        if (refreshed) setCloudflared(refreshed)
      }
    } finally {
      setSaving(false)
    }
  }

  const pickDirectory = async (
    field: 'defaultWorkingDirectory' | 'logDirectory'
  ): Promise<void> => {
    const current = draft?.[field] || undefined
    const selected = await run(() => window.api.system.selectDirectory(current), {
      error: 'Could not open folder picker'
    })
    if (selected && draft) {
      setDraft({ ...draft, [field]: selected })
    }
  }

  const handleDownloadCloudflared = async (): Promise<void> => {
    setBusyBinary('download')
    try {
      const status = await run(() => window.api.cloudflared.download(), {
        loading: 'Downloading official cloudflared binary…',
        success: (data) =>
          data.version ? `cloudflared v${data.version} installed` : 'cloudflared installed',
        error: 'Could not download cloudflared'
      })
      if (status) setCloudflared(status)
    } finally {
      setBusyBinary(null)
    }
  }

  const handleCheckUpdates = async (): Promise<void> => {
    setBusyBinary('check')
    try {
      const status = await run(() => window.api.cloudflared.checkForUpdates(), {
        success: (data) =>
          data.updateAvailable && data.latestVersion
            ? `Update available: v${data.latestVersion}`
            : data.version
              ? `cloudflared v${data.version} is up to date`
              : 'Checked cloudflared release status',
        error: 'Could not check for cloudflared updates'
      })
      if (status) setCloudflared(status)
    } finally {
      setBusyBinary(null)
    }
  }

  const handleSelectBinary = async (): Promise<void> => {
    setBusyBinary('select')
    try {
      const status = await run(() => window.api.cloudflared.selectBinary(), {
        success: (data) => (data.available ? 'Custom cloudflared binary configured' : ''),
        error: 'Could not select cloudflared binary'
      })
      if (status) {
        setCloudflared(status)
        const latestSettings = await run(() => window.api.settings.get())
        if (latestSettings) {
          setSettings(latestSettings)
          setDraft(latestSettings)
        }
      }
    } finally {
      setBusyBinary(null)
    }
  }

  const handleResetBinary = async (): Promise<void> => {
    setBusyBinary('reset')
    try {
      const status = await run(() => window.api.cloudflared.resetBinaryPath(), {
        success: 'Reset to automatic cloudflared detection',
        error: 'Could not reset cloudflared path'
      })
      if (status) {
        setCloudflared(status)
        const latestSettings = await run(() => window.api.settings.get())
        if (latestSettings) {
          setSettings(latestSettings)
          setDraft(latestSettings)
        }
      }
    } finally {
      setBusyBinary(null)
    }
  }

  if (!draft) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner className="size-5" />
      </div>
    )
  }

  const isDownloading = Boolean(cloudflared?.downloading || busyBinary === 'download')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configure application defaults, cloudflared binary management, timeouts, and logs."
        actions={
          hasChanges ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => settings && setDraft(settings)}
              >
                Discard
              </Button>
              <Button size="sm" disabled={saving} onClick={() => void saveNumericAndPaths()}>
                {saving ? <Spinner /> : <Save />}
                Save changes
              </Button>
            </div>
          ) : null
        }
      />

      <Tabs defaultValue="preferences" className="space-y-5">
        <TabsList>
          <TabsTrigger value="preferences" className="gap-1.5">
            <Wrench className="size-3.5" />
            Preferences
          </TabsTrigger>
          <TabsTrigger value="system-logs" className="gap-1.5">
            <Terminal className="size-3.5" />
            System Logs
          </TabsTrigger>
          <TabsTrigger value="about" className="gap-1.5">
            <Info className="size-3.5" />
            About &amp; Paths
          </TabsTrigger>
        </TabsList>

        <TabsContent value="preferences" className="space-y-6">
          {/* Cloudflared Binary Management */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    cloudflared Binary
                    {cloudflared?.available ? (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle2 className="size-3" />
                        Ready
                      </Badge>
                    ) : (
                      <Badge variant="destructive">Not installed</Badge>
                    )}
                    {cloudflared?.updateAvailable && cloudflared.latestVersion && (
                      <Badge variant="warning">Update v{cloudflared.latestVersion}</Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Official Cloudflare Tunnel CLI downloaded directly from GitHub Releases.
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    disabled={isDownloading || busyBinary !== null}
                    onClick={() => void handleDownloadCloudflared()}
                  >
                    {isDownloading ? <Spinner /> : <CloudDownload />}
                    {cloudflared?.available
                      ? cloudflared.updateAvailable
                        ? 'Update cloudflared'
                        : 'Reinstall managed'
                      : 'Download cloudflared'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isDownloading || busyBinary !== null}
                    onClick={() => void handleCheckUpdates()}
                  >
                    {busyBinary === 'check' ? <Spinner /> : <RefreshCw />}
                    Check updates
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {isDownloading && (
                <div className="space-y-1.5 rounded-lg border border-primary/25 bg-primary/5 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">
                      Downloading official cloudflared binary…
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {downloadProgress
                        ? downloadProgress.percent !== null
                          ? `${downloadProgress.percent}% (${formatBytes(downloadProgress.receivedBytes)})`
                          : formatBytes(downloadProgress.receivedBytes)
                        : 'Connecting…'}
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-200"
                      style={{
                        width: `${downloadProgress?.percent ?? 15}%`
                      }}
                    />
                  </div>
                </div>
              )}

              {cloudflared?.lastError && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {cloudflared.lastError}
                </div>
              )}

              <div className="grid gap-3 rounded-lg border border-border bg-muted/20 p-3.5 text-xs sm:grid-cols-3">
                <div>
                  <p className="text-[11px] text-muted-foreground">Detected version</p>
                  <p className="mt-0.5 font-mono font-medium text-foreground">
                    {cloudflared?.version ? `v${cloudflared.version}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Source</p>
                  <p className="mt-0.5 capitalize font-medium text-foreground">
                    {cloudflared?.source ?? 'Not detected'}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-muted-foreground">Last checked</p>
                  <p className="mt-0.5 tabular-nums text-foreground">
                    {formatDateTime(cloudflared?.lastCheckedAt)}
                  </p>
                </div>
                <div className="sm:col-span-3">
                  <p className="text-[11px] text-muted-foreground">Active binary path</p>
                  <p className="mt-0.5 break-all font-mono text-foreground/90">
                    {cloudflared?.path ?? cloudflared?.managedPath ?? '—'}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cloudflaredPath">Custom binary path (optional)</Label>
                <div className="flex flex-wrap gap-2">
                  <Input
                    id="cloudflaredPath"
                    value={draft.cloudflaredPath}
                    onChange={(event) =>
                      setDraft({ ...draft, cloudflaredPath: event.target.value })
                    }
                    placeholder="Leave empty for managed binary or system PATH"
                    className="min-w-60 flex-1 font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busyBinary !== null}
                    onClick={() => void handleSelectBinary()}
                  >
                    <FolderOpen />
                    Browse…
                  </Button>
                  {draft.cloudflaredPath && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={busyBinary !== null}
                      onClick={() => void handleResetBinary()}
                    >
                      <RotateCcw />
                      Reset
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* General */}
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
              <CardDescription>
                Desktop behavior, theme preference, and default project directory.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="divide-y divide-border/60">
                <ToggleRow
                  id="launchOnStartup"
                  label="Start on Windows startup"
                  description="Launch Local App Manager automatically when you sign in to Windows."
                  checked={draft.launchOnStartup}
                  onCheckedChange={(checked) => void patchImmediate({ launchOnStartup: checked })}
                />
                <ToggleRow
                  id="minimizeToTray"
                  label="Minimize to system tray"
                  description="Keep running applications and tunnels alive in the tray when you close the window."
                  checked={draft.minimizeToTray}
                  onCheckedChange={(checked) => void patchImmediate({ minimizeToTray: checked })}
                />
                <ToggleRow
                  id="destroyWindowOnHide"
                  label="Free memory when hidden"
                  description="Destroy the window instead of hiding it. Saves roughly 120 MB of RAM while in the tray; reopening takes a moment longer."
                  checked={draft.destroyWindowOnHide}
                  disabled={!draft.minimizeToTray}
                  onCheckedChange={(checked) => void patchImmediate({ destroyWindowOnHide: checked })}
                />
                <ToggleRow
                  id="launchMinimized"
                  label="Launch minimized"
                  description="Start hidden in the system tray instead of opening the main window."
                  checked={draft.launchMinimized}
                  onCheckedChange={(checked) => void patchImmediate({ launchMinimized: checked })}
                />
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="theme">Theme</Label>
                  <Select
                    value={draft.theme}
                    onValueChange={(value) =>
                      void patchImmediate({ theme: value as ThemeMode })
                    }
                  >
                    <SelectTrigger id="theme">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dark">Dark (Default)</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="system">System</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultWorkingDirectory">Default working directory</Label>
                  <div className="flex gap-2">
                    <Input
                      id="defaultWorkingDirectory"
                      value={draft.defaultWorkingDirectory}
                      onChange={(event) =>
                        setDraft({ ...draft, defaultWorkingDirectory: event.target.value })
                      }
                      placeholder="C:\Users\you\projects"
                      className="font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Browse folder"
                      onClick={() => void pickDirectory('defaultWorkingDirectory')}
                    >
                      <FolderOpen />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Tunnel */}
          <Card>
            <CardHeader>
              <CardTitle>Tunnel</CardTitle>
              <CardDescription>
                Default protocol, tunnel mode, and startup timeout for Cloudflare Tunnels.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="defaultTunnelType">Default tunnel type</Label>
                  <Select
                    value={draft.defaultTunnelType}
                    onValueChange={(value) =>
                      void patchImmediate({ defaultTunnelType: value as TunnelType })
                    }
                  >
                    <SelectTrigger id="defaultTunnelType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quick">Quick Tunnel (no login)</SelectItem>
                      <SelectItem value="named">Named Tunnel (Cloudflare account)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="defaultProtocol">Default local protocol</Label>
                  <Select
                    value={draft.defaultProtocol}
                    onValueChange={(value) =>
                      void patchImmediate({ defaultProtocol: value as LocalProtocol })
                    }
                  >
                    <SelectTrigger id="defaultProtocol">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">HTTP</SelectItem>
                      <SelectItem value="https">HTTPS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="tunnelStartupTimeout">Tunnel startup timeout (seconds)</Label>
                  <Input
                    id="tunnelStartupTimeout"
                    type="number"
                    min={15}
                    max={600}
                    value={Math.round(draft.tunnelStartupTimeoutMs / 1_000)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        tunnelStartupTimeoutMs: Number(event.target.value || 15) * 1_000
                      })
                    }
                  />
                </div>
              </div>

              <Separator />

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                  <div>
                    <p className="text-xs font-medium text-foreground">
                      Public exposure confirmation
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {draft.hasAcceptedPublicWarning
                        ? 'You have acknowledged that Quick Tunnels expose local apps publicly.'
                        : 'You will be prompted to confirm before starting your first tunnel.'}
                    </p>
                  </div>
                </div>
                {draft.hasAcceptedPublicWarning && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void patchImmediate(
                        { hasAcceptedPublicWarning: false },
                        'Public exposure warning will be shown on next tunnel start'
                      )
                    }
                  >
                    Require confirmation again
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Application */}
          <Card>
            <CardHeader>
              <CardTitle>Application</CardTitle>
              <CardDescription>
                Startup readiness checks, health polling interval, and graceful shutdown limits.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="appStartupTimeout">Default startup timeout (seconds)</Label>
                  <Input
                    id="appStartupTimeout"
                    type="number"
                    min={10}
                    max={600}
                    value={Math.round(draft.appStartupTimeoutMs / 1_000)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        appStartupTimeoutMs: Number(event.target.value || 10) * 1_000
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="healthCheckInterval">Health check interval (seconds)</Label>
                  <Input
                    id="healthCheckInterval"
                    type="number"
                    min={5}
                    max={300}
                    value={Math.round(draft.healthCheckIntervalMs / 1_000)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        healthCheckIntervalMs: Number(event.target.value || 5) * 1_000
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="processTerminationTimeout">
                    Process termination timeout (seconds)
                  </Label>
                  <Input
                    id="processTerminationTimeout"
                    type="number"
                    min={1}
                    max={60}
                    value={Math.round(draft.processTerminationTimeoutMs / 1_000)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        processTerminationTimeoutMs: Number(event.target.value || 1) * 1_000
                      })
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Logs */}
          <Card>
            <CardHeader>
              <CardTitle>Logs</CardTitle>
              <CardDescription>
                Retention limits, log output directory, and automatic cleanup schedule.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow
                id="autoCleanupLogs"
                label="Automatic log cleanup"
                description="Automatically delete rotated log files older than the retention period."
                checked={draft.autoCleanupLogs}
                onCheckedChange={(checked) => void patchImmediate({ autoCleanupLogs: checked })}
              />

              <Separator />

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="maxLogEntries">Max in-memory log entries</Label>
                  <Input
                    id="maxLogEntries"
                    type="number"
                    min={100}
                    max={50_000}
                    step={100}
                    value={draft.maxLogEntries}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        maxLogEntries: Number(event.target.value || 100)
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="logRetentionDays">Log retention (days)</Label>
                  <Input
                    id="logRetentionDays"
                    type="number"
                    min={1}
                    max={365}
                    value={draft.logRetentionDays}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        logRetentionDays: Number(event.target.value || 1)
                      })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="logDirectory">Log directory</Label>
                  <div className="flex gap-2">
                    <Input
                      id="logDirectory"
                      value={draft.logDirectory}
                      onChange={(event) =>
                        setDraft({ ...draft, logDirectory: event.target.value })
                      }
                      placeholder={systemInfo?.logsPath ?? 'Default userData/logs'}
                      className="font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      title="Browse log folder"
                      onClick={() => void pickDirectory('logDirectory')}
                    >
                      <FolderOpen />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {hasChanges && (
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => settings && setDraft(settings)}
              >
                Discard
              </Button>
              <Button size="sm" disabled={saving} onClick={() => void saveNumericAndPaths()}>
                {saving ? <Spinner /> : <Save />}
                Save changes
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="system-logs">
          <div className="h-[62vh] min-h-[420px]">
            <LogViewer
              source="system"
              title="System Logs"
              subtitle="Application lifecycle, health checks, cloudflared operations, and errors"
            />
          </div>
        </TabsContent>

        <TabsContent value="about" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    Application Updates
                    <Badge variant="outline" className="font-mono">
                      v{updater?.currentVersion ?? systemInfo?.appVersion ?? '1.0.0'}
                    </Badge>
                    {updater?.state === 'available' && updater.availableVersion && (
                      <Badge variant="warning">Update v{updater.availableVersion}</Badge>
                    )}
                    {updater?.state === 'downloaded' && (
                      <Badge variant="success">Ready to install</Badge>
                    )}
                    {updater?.state === 'not-available' && (
                      <Badge variant="success">Up to date</Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    Checks official releases from GitHub (<span className="font-mono">angkrnia/local-app-manager</span>).
                  </CardDescription>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      busyUpdater !== null ||
                      updater?.state === 'checking' ||
                      updater?.state === 'downloading'
                    }
                    onClick={async () => {
                      setBusyUpdater('check')
                      const status = await run(() => window.api.updater.check(), {
                        success: (data) =>
                          data.state === 'available' && data.availableVersion
                            ? `Update v${data.availableVersion} is available`
                            : data.message || 'Checked for updates',
                        error: 'Could not check for updates'
                      })
                      if (status) setUpdater(status)
                      setBusyUpdater(null)
                    }}
                  >
                    {busyUpdater === 'check' || updater?.state === 'checking' ? (
                      <Spinner />
                    ) : (
                      <RefreshCw />
                    )}
                    Check for updates
                  </Button>

                  {updater?.state === 'available' && (
                    <Button
                      size="sm"
                      disabled={busyUpdater !== null}
                      onClick={async () => {
                        setBusyUpdater('download')
                        const status = await run(() => window.api.updater.download(), {
                          loading: updater.canAutoInstall
                            ? 'Downloading update…'
                            : 'Opening GitHub Releases…',
                          success: updater.canAutoInstall ? undefined : 'Opened GitHub Releases',
                          error: 'Could not download update'
                        })
                        if (status) setUpdater(status)
                        setBusyUpdater(null)
                      }}
                    >
                      {busyUpdater === 'download' ? <Spinner /> : <ArrowDownToLine />}
                      {updater.canAutoInstall ? 'Download update' : 'Download on GitHub'}
                    </Button>
                  )}

                  {updater?.state === 'downloaded' && (
                    <Button
                      size="sm"
                      disabled={busyUpdater !== null}
                      onClick={async () => {
                        setBusyUpdater('install')
                        await run(() => window.api.updater.install(), {
                          error: 'Could not install update'
                        })
                        setBusyUpdater(null)
                      }}
                    >
                      {busyUpdater === 'install' ? <Spinner /> : <CheckCircle2 />}
                      Restart &amp; install
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      void run(() => window.api.updater.openReleasePage(), {
                        error: 'Could not open GitHub Releases'
                      })
                    }
                  >
                    <ExternalLink />
                    Releases
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {updater?.state === 'downloading' && updater.progress && (
                <div className="space-y-1.5 rounded-lg border border-primary/25 bg-primary/5 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-foreground">
                      {updater.message ?? 'Downloading update…'}
                    </span>
                    <span className="tabular-nums text-muted-foreground">
                      {updater.progress.percent}% ({formatBytes(updater.progress.transferred)} /{' '}
                      {formatBytes(updater.progress.total)})
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-200"
                      style={{ width: `${updater.progress.percent}%` }}
                    />
                  </div>
                </div>
              )}

              {updater?.message && updater.state !== 'downloading' && (
                <p
                  className={cn(
                    'text-xs',
                    updater.state === 'error' ? 'text-destructive' : 'text-muted-foreground'
                  )}
                >
                  {updater.message}
                </p>
              )}

              {!updater?.canAutoInstall && (
                <p className="text-[11px] text-muted-foreground">
                  Automatic in-app installation is available on the Windows Installer (Setup) build.
                  Portable and development builds open GitHub Releases to download updates.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Runtime Environment</CardTitle>
              <CardDescription>
                Diagnostics and local data paths on this machine.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-[11px] text-muted-foreground">App version</p>
                  <p className="mt-1 font-mono font-medium">
                    v{systemInfo?.appVersion ?? '1.0.0'}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-[11px] text-muted-foreground">Electron</p>
                  <p className="mt-1 font-mono font-medium">
                    {systemInfo?.electronVersion ?? '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-[11px] text-muted-foreground">Node.js</p>
                  <p className="mt-1 font-mono font-medium">{systemInfo?.nodeVersion ?? '—'}</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-[11px] text-muted-foreground">Platform</p>
                  <p className="mt-1 font-mono font-medium">
                    {systemInfo ? `${systemInfo.platform} (${systemInfo.arch})` : '—'}
                  </p>
                </div>
              </div>

              <div className="divide-y divide-border/60 rounded-lg border border-border">
                {[
                  { label: 'User Data', path: systemInfo?.userDataPath, folder: true },
                  { label: 'SQLite Database', path: systemInfo?.databasePath, folder: false },
                  { label: 'Logs Directory', path: systemInfo?.logsPath, folder: true }
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{item.label}</p>
                      <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                        {item.path ?? '—'}
                      </p>
                    </div>
                    {item.path && (
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() =>
                          void run(
                            () =>
                              item.folder
                                ? window.api.system.openPath(item.path!)
                                : window.api.system.showItemInFolder(item.path!),
                            { error: 'Could not open location' }
                          )
                        }
                      >
                        <FolderOpen />
                        Open
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
