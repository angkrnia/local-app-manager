import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, FolderOpen, Loader2, Plus, Trash2, XCircle } from 'lucide-react'
import type { Application, ApplicationInput, ApplicationType, PortCheckResult } from '@shared/types'
import { APPLICATION_TYPE_OPTIONS, MASKED_SECRET } from '@shared/constants'
import { errorMessage, unwrap } from '@/lib/api'
import { applicationTypeOption } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { run } from '@/lib/run'
import { useAppStore } from '@/stores/app-store'
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

interface EnvRow {
  id: string
  key: string
  value: string
}

interface FormState {
  name: string
  projectName: string
  description: string
  projectDirectory: string
  workingDirectory: string
  applicationType: ApplicationType
  startCommand: string
  stopCommand: string
  localHost: string
  localPort: string
  autoStart: boolean
  env: EnvRow[]
}

let rowCounter = 0
function nextRowId(): string {
  rowCounter += 1
  return `env-${rowCounter}`
}

function toRows(environment: Record<string, string>): EnvRow[] {
  return Object.entries(environment).map(([key, value]) => ({ id: nextRowId(), key, value }))
}

function emptyForm(defaultDirectory: string): FormState {
  return {
    name: '',
    projectName: '',
    description: '',
    projectDirectory: defaultDirectory,
    workingDirectory: '',
    applicationType: 'node',
    startCommand: 'npm run dev',
    stopCommand: '',
    localHost: '127.0.0.1',
    localPort: '',
    autoStart: false,
    env: []
  }
}

function fromApplication(application: Application): FormState {
  return {
    name: application.name,
    projectName: application.projectName ?? '',
    description: application.description,
    projectDirectory: application.projectDirectory,
    workingDirectory: application.workingDirectory,
    applicationType: application.applicationType,
    startCommand: application.startCommand,
    stopCommand: application.stopCommand ?? '',
    localHost: application.localHost,
    localPort: application.localPort === null ? '' : String(application.localPort),
    autoStart: application.autoStart,
    env: toRows(application.environmentVariables)
  }
}

export function ApplicationFormDialog({
  open,
  onOpenChange,
  application,
  defaultDirectory = ''
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  application?: Application | null
  defaultDirectory?: string
}): React.JSX.Element {
  const [form, setForm] = useState<FormState>(() => emptyForm(defaultDirectory))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [portCheck, setPortCheck] = useState<PortCheckResult | null>(null)
  const [checkingPort, setCheckingPort] = useState(false)
  const [killingPort, setKillingPort] = useState(false)
  const commandTouched = useRef(false)
  const isEdit = Boolean(application)
  const allApplications = useAppStore((state) => state.applications)
  const existingProjects = useMemo(() => {
    const names = new Set<string>()
    for (const item of allApplications) {
      const trimmed = item.projectName?.trim()
      if (trimmed) names.add(trimmed)
    }
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [allApplications])

  useEffect(() => {
    if (!open) return
    setForm(application ? fromApplication(application) : emptyForm(defaultDirectory))
    setError(null)
    setPortCheck(null)
    commandTouched.current = false
  }, [open, application, defaultDirectory])

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleTypeChange = (value: ApplicationType): void => {
    const option = applicationTypeOption(value)
    setForm((current) => ({
      ...current,
      applicationType: value,
      startCommand: commandTouched.current ? current.startCommand : option.defaultCommand
    }))
    setPortCheck(null)
  }

  const browse = async (target: 'projectDirectory' | 'workingDirectory'): Promise<void> => {
    try {
      const selected = await unwrap(
        window.api.system.selectDirectory(form[target] || form.projectDirectory || defaultDirectory || undefined)
      )
      if (selected) update(target, selected)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const checkPort = async (): Promise<void> => {
    const port = Number(form.localPort)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      setError('Enter a port between 1 and 65535 before checking.')
      return
    }
    setCheckingPort(true)
    setError(null)
    try {
      const result = await unwrap(window.api.applications.checkPort(form.localHost.trim() || '127.0.0.1', port))
      setPortCheck(result)
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setCheckingPort(false)
    }
  }

  const envKeys = useMemo(() => form.env.map((row) => row.key.trim()).filter(Boolean), [form.env])
  const duplicateKeys = envKeys.filter((key, index) => envKeys.indexOf(key) !== index)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setError(null)

    const trimmedPort = form.localPort.trim()
    let port: number | null = null
    if (trimmedPort !== '') {
      const parsedPort = Number(trimmedPort)
      if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
        return setError('Port must be a whole number between 1 and 65535, or left empty for auto-detect.')
      }
      port = parsedPort
    }
    if (!form.name.trim()) return setError('Application name is required.')
    if (!form.projectDirectory.trim()) return setError('Project directory is required.')
    if (!form.startCommand.trim()) return setError('Start command is required.')
    if (duplicateKeys.length > 0) {
      return setError(`Duplicate environment variable: ${duplicateKeys[0]}`)
    }

    const environmentVariables: Record<string, string> = {}
    for (const row of form.env) {
      const key = row.key.trim()
      if (!key) continue
      environmentVariables[key] = row.value
    }

    const input: ApplicationInput = {
      name: form.name.trim(),
      projectName: form.projectName.trim(),
      description: form.description.trim(),
      projectDirectory: form.projectDirectory.trim(),
      workingDirectory: form.workingDirectory.trim(),
      applicationType: form.applicationType,
      startCommand: form.startCommand.trim(),
      stopCommand: form.stopCommand.trim() || null,
      localHost: form.localHost.trim() || '127.0.0.1',
      localPort: port,
      environmentVariables,
      autoStart: form.autoStart
    }

    setBusy(true)
    const result = await run(
      () =>
        application
          ? window.api.applications.update(application.id, input)
          : window.api.applications.create(input),
      {
        success: application ? 'Application updated' : 'Application added',
        error: application ? 'Could not update application' : 'Could not add application'
      }
    )
    setBusy(false)
    if (result) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (!busy ? onOpenChange(next) : undefined)}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit application' : 'Add application'}</DialogTitle>
          <DialogDescription>
            Local App Manager runs this command in the selected directory and forwards the local port through
            Cloudflare.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(event) => void submit(event)} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="app-name">Name</Label>
              <Input
                id="app-name"
                value={form.name}
                onChange={(event) => update('name', event.target.value)}
                placeholder="My Next.js app"
                maxLength={80}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-project">Project / Group</Label>
              <Input
                id="app-project"
                list="tm-existing-projects"
                value={form.projectName}
                onChange={(event) => update('projectName', event.target.value)}
                placeholder="e.g. Storefront, Admin API, Docs"
                maxLength={80}
              />
              {existingProjects.length > 0 && (
                <>
                  <datalist id="tm-existing-projects">
                    {existingProjects.map((project) => (
                      <option key={project} value={project} />
                    ))}
                  </datalist>
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {existingProjects.map((project) => (
                      <button
                        key={project}
                        type="button"
                        onClick={() => update('projectName', project)}
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
                          form.projectName.trim() === project
                            ? 'border-primary/40 bg-primary/15 text-primary'
                            : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {project}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="app-description">Description</Label>
              <Input
                id="app-description"
                value={form.description}
                onChange={(event) => update('description', event.target.value)}
                placeholder="Optional note about this application"
                maxLength={500}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Application type</Label>
              <Select value={form.applicationType} onValueChange={(value) => handleTypeChange(value as ApplicationType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {APPLICATION_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end pb-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={form.autoStart} onCheckedChange={(checked) => update('autoStart', checked)} />
                Start when Local App Manager launches
              </label>
            </div>
          </div>

          <Separator />

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="app-project">Project directory</Label>
              <div className="flex gap-2">
                <Input
                  id="app-project"
                  value={form.projectDirectory}
                  onChange={(event) => update('projectDirectory', event.target.value)}
                  placeholder="C:\Users\you\projects\my-app"
                  className="font-mono text-xs"
                />
                <Button type="button" variant="outline" size="icon" onClick={() => void browse('projectDirectory')}>
                  <FolderOpen />
                  <span className="sr-only">Browse project directory</span>
                </Button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="app-working">Working directory</Label>
              <div className="flex gap-2">
                <Input
                  id="app-working"
                  value={form.workingDirectory}
                  onChange={(event) => update('workingDirectory', event.target.value)}
                  placeholder="Defaults to the project directory"
                  className="font-mono text-xs"
                />
                <Button type="button" variant="outline" size="icon" onClick={() => void browse('workingDirectory')}>
                  <FolderOpen />
                  <span className="sr-only">Browse working directory</span>
                </Button>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="app-command">Start command</Label>
                <Input
                  id="app-command"
                  value={form.startCommand}
                  onChange={(event) => {
                    commandTouched.current = true
                    update('startCommand', event.target.value)
                  }}
                  placeholder="npm run dev"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="app-stop">Stop command (optional)</Label>
                <Input
                  id="app-stop"
                  value={form.stopCommand}
                  onChange={(event) => update('stopCommand', event.target.value)}
                  placeholder="Sent before terminating the process"
                  className="font-mono text-xs"
                />
              </div>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label>Local address</Label>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1 space-y-1.5">
                <Input
                  value={form.localHost}
                  onChange={(event) => {
                    update('localHost', event.target.value)
                    setPortCheck(null)
                  }}
                  placeholder="127.0.0.1"
                  className="font-mono text-xs"
                  aria-label="Local host"
                />
              </div>
              <div className="w-28 space-y-1.5">
                <Input
                  value={form.localPort}
                  onChange={(event) => {
                    update('localPort', event.target.value.replace(/[^\d]/g, ''))
                    setPortCheck(null)
                  }}
                  placeholder="Auto"
                  inputMode="numeric"
                  className="font-mono text-xs"
                  aria-label="Local port"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={checkingPort || !form.localPort.trim()}
                onClick={() => void checkPort()}
              >
                {checkingPort ? <Loader2 className="animate-spin" /> : null}
                Check port
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Leave port empty to auto-detect when the application starts.
            </p>
            {portCheck && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p
                  className={cn(
                    'flex items-center gap-1.5 text-xs',
                    portCheck.available ? 'text-success' : 'text-destructive'
                  )}
                >
                  {portCheck.available ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                  {portCheck.available
                    ? `Port ${portCheck.port} is available on ${portCheck.host}.`
                    : `Port ${portCheck.port} is in use${portCheck.processName ? ` by ${portCheck.processName}` : ''}.`}
                </p>
                {!portCheck.available && (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={killingPort}
                    onClick={async () => {
                      setKillingPort(true)
                      const killed = await run(() => window.api.ports.kill(portCheck.port), {
                        success: (res) => `Freed port ${res.port} (killed ${res.processName})`,
                        error: `Could not kill process on port ${portCheck.port}`
                      })
                      setKillingPort(false)
                      if (killed) {
                        setPortCheck({
                          ...portCheck,
                          inUse: false,
                          available: true,
                          processName: null
                        })
                      }
                    }}
                  >
                    {killingPort ? <Loader2 className="animate-spin" /> : null}
                    Kill port {portCheck.port}
                  </Button>
                )}
              </div>
            )}
          </div>

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label>Environment variables</Label>
                <p className="text-[11px] text-muted-foreground">
                  Sensitive values are encrypted at rest. Masked values are kept unchanged.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="xs"
                onClick={() => update('env', [...form.env, { id: nextRowId(), key: '', value: '' }])}
              >
                <Plus />
                Add variable
              </Button>
            </div>
            {form.env.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-center text-[11px] text-muted-foreground">
                No environment variables. PORT is injected automatically when a local port is set.
              </p>
            ) : (
              <div className="space-y-2">
                {form.env.map((row, index) => {
                  const duplicate = row.key.trim() !== '' && duplicateKeys.includes(row.key.trim())
                  return (
                    <div key={row.id} className="flex items-center gap-2">
                      <Input
                        value={row.key}
                        onChange={(event) => {
                          const env = [...form.env]
                          env[index] = { ...row, key: event.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }
                          update('env', env)
                        }}
                        placeholder="KEY"
                        className={cn('w-44 shrink-0 font-mono text-xs', duplicate && 'border-destructive')}
                        aria-label={`Environment variable ${index + 1} name`}
                      />
                      <Input
                        value={row.value}
                        type={row.value === MASKED_SECRET ? 'password' : 'text'}
                        onChange={(event) => {
                          const env = [...form.env]
                          env[index] = { ...row, value: event.target.value }
                          update('env', env)
                        }}
                        placeholder="value"
                        className="min-w-0 flex-1 font-mono text-xs"
                        aria-label={`Environment variable ${index + 1} value`}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => update('env', form.env.filter((item) => item.id !== row.id))}
                        title="Remove variable"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" />}
              {isEdit ? 'Save changes' : 'Add application'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
