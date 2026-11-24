import { shell } from 'electron'
import type {
  BatchResult,
  NamedTunnelInput,
  QuickTunnelInput,
  Tunnel,
  TunnelStatus
} from '@shared/types'
import {
  namedTunnelInputSchema,
  quickTunnelInputSchema,
  formatZodError
} from '@shared/validation'
import { PUBLIC_EXPOSURE_WARNING } from '@shared/constants'
import { AppError, ErrorCode, toErrorMessage } from '@shared/errors'
import type { ApplicationRecord, TunnelRecord } from '../database/records'
import type { TunnelsRepository } from '../database/repositories/tunnels'
import type { ProcessSessionsRepository } from '../database/repositories/process-sessions'
import type { ActivityRepository } from '../database/repositories/activity-logs'
import type { SettingsService } from '../settings'
import type { LogManager } from '../log-manager'
import type { EventBus } from '../event-bus'
import type { CloudflaredProvider } from '../cloudflared-manager/provider'
import { ManagedProcess, type ProcessExitInfo } from '../process-manager'
import { isPortInUse, sleep } from '../../utils/net'
import { effectiveHost } from '../application-manager'
import { detectLogLevel } from '../log-manager'
import {
  TunnelUrlDetector,
  isNamedTunnelConnected
} from './url-detector'

export interface ApplicationLookup {
  getRecord(id: string): ApplicationRecord
  getLocalUrl(record: ApplicationRecord): string
  get(id: string): unknown
}

interface TunnelRuntime {
  process: ManagedProcess | null
  status: TunnelStatus
  publicUrl: string | null
  startedAt: string | null
  lastError: string | null
  pid: number | null
  sessionId: string | null
  startPromise: Promise<Tunnel> | null
  stopPromise: Promise<Tunnel> | null
  recentOutput: string[]
}

interface ReadyResult {
  url: string | null
  exited: boolean
  timedOut: boolean
}

export interface TunnelManagerDeps {
  repository: TunnelsRepository
  applications: ApplicationLookup
  sessions: ProcessSessionsRepository
  activity: ActivityRepository
  settings: SettingsService
  logs: LogManager
  events: EventBus
  cloudflared: CloudflaredProvider
  workingDirectory: string
}

function createRuntime(): TunnelRuntime {
  return {
    process: null,
    status: 'stopped',
    publicUrl: null,
    startedAt: null,
    lastError: null,
    pid: null,
    sessionId: null,
    startPromise: null,
    stopPromise: null,
    recentOutput: []
  }
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index]
      index += 1
      if (current !== undefined) await worker(current)
    }
  })
  await Promise.allSettled(runners)
}

export class TunnelManager {
  private readonly runtimes = new Map<string, TunnelRuntime>()
  private shuttingDown = false

  constructor(private readonly deps: TunnelManagerDeps) {}

  // ---------------------------------------------------------------- queries

  list(): Tunnel[] {
    return this.deps.repository.list().map((record) => this.toDto(record))
  }

  get(id: string): Tunnel {
    return this.toDto(this.requireRecord(id))
  }

  listForApplication(applicationId: string): Tunnel[] {
    return this.deps.repository.listForApplication(applicationId).map((record) => this.toDto(record))
  }

  // ---------------------------------------------------------------- creation

  async createQuick(input: QuickTunnelInput): Promise<Tunnel> {
    const parsed = quickTunnelInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION, formatZodError(parsed.error))
    }
    const application = this.deps.applications.getRecord(parsed.data.applicationId)
    const localUrl = this.deps.applications.getLocalUrl(application)
    const record = this.deps.repository.create({
      applicationId: application.id,
      tunnelType: 'quick',
      tunnelName: parsed.data.name?.trim() || null,
      cloudflareTunnelId: null,
      hostname: null,
      localUrl,
      publicUrl: null,
      status: 'stopped'
    })
    this.recordActivity('info', `Quick tunnel created for "${application.name}"`, record.id, application.id)
    this.broadcast()
    if (parsed.data.startNow) {
      return this.start(record.id)
    }
    return this.get(record.id)
  }

  async createNamed(input: NamedTunnelInput): Promise<Tunnel> {
    const parsed = namedTunnelInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION, formatZodError(parsed.error))
    }
    const application = this.deps.applications.getRecord(parsed.data.applicationId)
    if (!this.deps.cloudflared.getAuthStatus().authenticated) {
      throw new AppError(
        ErrorCode.CLOUDFLARE_NOT_AUTHENTICATED,
        'Connect your Cloudflare account before adding a named tunnel.'
      )
    }
    const remoteTunnels = await this.deps.cloudflared.listTunnels()
    const remote = remoteTunnels.find((tunnel) => tunnel.name === parsed.data.tunnelName)
    if (!remote) {
      throw new AppError(
        ErrorCode.CLOUDFLARE_COMMAND_FAILED,
        `Named tunnel "${parsed.data.tunnelName}" was not found in your Cloudflare account. Create it first, then refresh the list.`
      )
    }
    const localUrl = this.deps.applications.getLocalUrl(application)
    const record = this.deps.repository.create({
      applicationId: application.id,
      tunnelType: 'named',
      tunnelName: parsed.data.tunnelName,
      cloudflareTunnelId: remote.id || null,
      hostname: parsed.data.hostname,
      localUrl,
      publicUrl: `https://${parsed.data.hostname}`,
      status: 'stopped'
    })
    this.recordActivity(
      'info',
      `Named tunnel "${parsed.data.tunnelName}" added for "${application.name}"`,
      record.id,
      application.id
    )
    this.broadcast()
    if (parsed.data.startNow) {
      return this.start(record.id)
    }
    return this.get(record.id)
  }

  // --------------------------------------------------------------- lifecycle

  async start(id: string, acknowledgePublicExposure = false): Promise<Tunnel> {
    const runtime = this.ensureRuntime(id)
    if (runtime.process?.running) return this.get(id)
    if (runtime.startPromise) return runtime.startPromise

    const promise = this.doStart(id, runtime, acknowledgePublicExposure).finally(() => {
      runtime.startPromise = null
    })
    runtime.startPromise = promise
    return promise
  }

  private async doStart(
    id: string,
    runtime: TunnelRuntime,
    acknowledgePublicExposure: boolean
  ): Promise<Tunnel> {
    const record = this.requireRecord(id)
    const settings = this.deps.settings.get()

    if (!settings.hasAcceptedPublicWarning && !acknowledgePublicExposure) {
      throw new AppError(ErrorCode.PUBLIC_EXPOSURE_NOT_ACKNOWLEDGED, PUBLIC_EXPOSURE_WARNING)
    }
    if (!settings.hasAcceptedPublicWarning) {
      this.deps.settings.update({ hasAcceptedPublicWarning: true })
    }

    const binary = await this.deps.cloudflared.getBinary()
    if (record.tunnelType === 'named' && !this.deps.cloudflared.getAuthStatus().authenticated) {
      throw new AppError(
        ErrorCode.CLOUDFLARE_NOT_AUTHENTICATED,
        'Cloudflare authentication is required for named tunnels. Sign in on the Tunnels page.'
      )
    }

    let localUrl = record.localUrl
    if (record.applicationId) {
      const application = this.deps.applications.getRecord(record.applicationId)
      localUrl = this.deps.applications.getLocalUrl(application)
      const reachable = await isPortInUse(
        effectiveHost(application.localHost),
        application.localPort,
        1_500
      )
      if (!reachable) {
        const message =
          `The local application "${application.name}" is not listening on ` +
          `${effectiveHost(application.localHost)}:${application.localPort}. Start the application first.`
        runtime.status = 'error'
        runtime.lastError = message
        this.persist(id, { status: 'error', lastError: message })
        this.log(id, 'error', message)
        this.broadcast()
        throw new AppError(ErrorCode.TUNNEL_START_FAILED, message)
      }
    }

    const publicUrl =
      record.tunnelType === 'named' && record.hostname ? `https://${record.hostname}` : null
    if (record.tunnelType === 'named' && !record.tunnelName) {
      throw new AppError(ErrorCode.INVALID_STATE, 'This named tunnel has no Cloudflare tunnel name.')
    }

    runtime.status = 'starting'
    runtime.publicUrl = publicUrl
    runtime.startedAt = null
    runtime.lastError = null
    runtime.recentOutput = []
    this.persist(id, {
      status: 'starting',
      localUrl,
      publicUrl,
      cloudflaredPid: null,
      startedAt: null,
      lastError: null
    })
    this.log(id, 'info', `Starting ${record.tunnelType} tunnel for ${localUrl}...`)
    this.broadcast()

    const detector = new TunnelUrlDetector()
    let settleReady: (result: ReadyResult) => void = () => undefined
    let readySettled = false
    const readiness = new Promise<ReadyResult>((resolve) => {
      settleReady = (result) => {
        if (readySettled) return
        readySettled = true
        resolve(result)
      }
    })

    const args = [
      'tunnel',
      '--no-autoupdate',
      '--loglevel',
      'info',
      '--url',
      localUrl
    ]
    if (record.tunnelType === 'named') {
      args.push('run', record.tunnelName as string)
    }
    const displayCommand = `${binary.path} ${args.join(' ')}`

    const managed = new ManagedProcess({
      id,
      label: `Tunnel ${record.tunnelName ?? record.id}`,
      command: displayCommand,
      executable: binary.executable,
      args: [...binary.args, ...args],
      cwd: this.deps.workingDirectory,
      env: {},
      onLine: (line, stream) => {
        runtime.recentOutput.push(line)
        if (runtime.recentOutput.length > 40) runtime.recentOutput.shift()
        this.log(id, detectLogLevel(line, 'info'), line, stream)
        if (record.tunnelType === 'quick') {
          const url = detector.push(line)
          if (url) settleReady({ url, exited: false, timedOut: false })
        } else if (isNamedTunnelConnected(line) && publicUrl) {
          settleReady({ url: publicUrl, exited: false, timedOut: false })
        }
      },
      onSpawn: (pid) => {
        runtime.pid = pid
        runtime.sessionId = this.deps.sessions.start({
          applicationId: record.applicationId,
          tunnelId: id,
          processType: 'tunnel',
          pid
        })
        this.persist(id, { cloudflaredPid: pid })
        this.broadcast()
      },
      onExit: (info) => {
        if (!readySettled) {
          settleReady({ url: null, exited: true, timedOut: false })
        }
        this.handleExit(id, info)
      },
      onError: (error) => {
        this.log(id, 'error', error.message)
      }
    })

    runtime.process = managed
    try {
      managed.spawn()
    } catch (error) {
      runtime.process = null
      runtime.status = 'error'
      runtime.lastError = toErrorMessage(error)
      this.persist(id, { status: 'error', lastError: runtime.lastError })
      this.broadcast()
      throw error
    }

    const result = await Promise.race([
      readiness,
      sleep(settings.tunnelStartupTimeoutMs).then<ReadyResult>(() => ({
        url: null,
        exited: false,
        timedOut: true
      }))
    ])

    if (result.url) {
      runtime.status = 'running'
      runtime.publicUrl = result.url
      runtime.startedAt = new Date().toISOString()
      runtime.lastError = null
      this.persist(id, {
        status: 'running',
        publicUrl: result.url,
        startedAt: runtime.startedAt,
        lastError: null
      })
      this.log(id, 'info', `Public URL is ready: ${result.url}`)
      this.recordActivity(
        'info',
        `Tunnel is live at ${result.url}`,
        id,
        record.applicationId
      )
      this.deps.events.toast({
        type: 'success',
        title: 'Tunnel is live',
        description: result.url
      })
      this.broadcast()
      return this.get(id)
    }

    if (result.exited) {
      const message =
        runtime.lastError ??
        'cloudflared exited before the tunnel became ready. Check the tunnel logs.'
      runtime.status = 'error'
      runtime.lastError = message
      this.persist(id, { status: 'error', lastError: message })
      this.broadcast()
      throw new AppError(ErrorCode.TUNNEL_START_FAILED, message)
    }

    const message =
      `cloudflared did not report a public URL within ` +
      `${Math.round(settings.tunnelStartupTimeoutMs / 1_000)} seconds. ` +
      'Check your internet connection and the tunnel logs, then try again.'
    runtime.status = 'error'
    runtime.lastError = message
    this.persist(id, { status: 'error', lastError: message })
    this.log(id, 'error', message)
    this.recordActivity('error', `Tunnel failed to start: ${message}`, id, record.applicationId)
    await managed.stop(5_000).catch(() => undefined)
    this.broadcast()
    throw new AppError(ErrorCode.TUNNEL_URL_TIMEOUT, message)
  }

  async stop(id: string): Promise<Tunnel> {
    const runtime = this.ensureRuntime(id)
    if (runtime.stopPromise) return runtime.stopPromise
    const record = this.requireRecord(id)
    if (!runtime.process?.running) {
      if (runtime.status !== 'error') runtime.status = 'stopped'
      runtime.startedAt = null
      runtime.pid = null
      this.persist(id, {
        status: runtime.status,
        cloudflaredPid: null,
        startedAt: null
      })
      this.broadcast()
      return this.get(id)
    }

    const promise = this.doStop(record, runtime).finally(() => {
      runtime.stopPromise = null
    })
    runtime.stopPromise = promise
    return promise
  }

  private async doStop(record: TunnelRecord, runtime: TunnelRuntime): Promise<Tunnel> {
    const settings = this.deps.settings.get()
    runtime.status = 'stopping'
    this.log(record.id, 'info', 'Stopping tunnel...')
    this.broadcast()

    await runtime.process?.stop(settings.processTerminationTimeoutMs)

    runtime.status = 'stopped'
    runtime.startedAt = null
    runtime.pid = null
    runtime.lastError = null
    if (record.tunnelType === 'quick') runtime.publicUrl = null
    this.persist(record.id, {
      status: 'stopped',
      cloudflaredPid: null,
      startedAt: null,
      lastError: null,
      publicUrl: runtime.publicUrl
    })
    this.log(record.id, 'info', 'Tunnel stopped')
    this.recordActivity('info', 'Tunnel stopped', record.id, record.applicationId)
    this.broadcast()
    return this.get(record.id)
  }

  async restart(id: string): Promise<Tunnel> {
    await this.stop(id)
    return this.start(id)
  }

  async remove(id: string): Promise<void> {
    const record = this.requireRecord(id)
    await this.stop(id).catch(() => undefined)
    this.deps.repository.delete(id)
    this.runtimes.delete(id)
    this.recordActivity('info', 'Tunnel deleted', null, record.applicationId)
    this.broadcast()
  }

  // ----------------------------------------------------------------- batches

  async startMany(ids: string[]): Promise<BatchResult> {
    return this.runBatch(ids, (id) => this.start(id))
  }

  async stopMany(ids: string[]): Promise<BatchResult> {
    return this.runBatch(ids, (id) => this.stop(id))
  }

  async restartMany(ids: string[]): Promise<BatchResult> {
    return this.runBatch(ids, async (id) => {
      await this.stop(id)
      await this.start(id)
    })
  }

  async startAll(): Promise<BatchResult> {
    return this.startMany(this.deps.repository.list().map((tunnel) => tunnel.id))
  }

  async stopAll(): Promise<BatchResult> {
    return this.stopMany(this.deps.repository.list().map((tunnel) => tunnel.id))
  }

  private async runBatch(
    ids: string[],
    worker: (id: string) => Promise<unknown>
  ): Promise<BatchResult> {
    const succeeded: string[] = []
    const failed: Array<{ id: string; error: string }> = []
    const unique = [...new Set(ids)]
    await mapWithConcurrency(unique, 4, async (id) => {
      try {
        await worker(id)
        succeeded.push(id)
      } catch (error) {
        failed.push({ id, error: toErrorMessage(error) })
      }
    })
    return { succeeded, failed }
  }

  // ------------------------------------------------------------------- misc

  async openPublicUrl(id: string): Promise<void> {
    const record = this.requireRecord(id)
    if (!record.publicUrl) {
      throw new AppError(ErrorCode.INVALID_STATE, 'This tunnel does not have a public URL yet.')
    }
    await shell.openExternal(record.publicUrl)
  }

  acceptPublicExposure(): void {
    this.deps.settings.update({ hasAcceptedPublicWarning: true })
  }

  async stopForApplication(applicationId: string): Promise<void> {
    const tunnels = this.deps.repository.listForApplication(applicationId)
    await Promise.allSettled(tunnels.map((tunnel) => this.stop(tunnel.id)))
  }

  async handleApplicationDeleted(applicationId: string): Promise<void> {
    await this.stopForApplication(applicationId)
    for (const [id, runtime] of this.runtimes) {
      const record = this.deps.repository.get(id)
      if (!record) {
        runtime.process?.forceKillSync()
        this.runtimes.delete(id)
      }
    }
    this.broadcast()
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    const ids = [...this.runtimes.keys()]
    await Promise.allSettled(ids.map((id) => this.stop(id)))
    for (const runtime of this.runtimes.values()) {
      runtime.process?.forceKillSync()
    }
  }

  // ---------------------------------------------------------------- private

  private requireRecord(id: string): TunnelRecord {
    const record = this.deps.repository.get(id)
    if (!record) throw new AppError(ErrorCode.NOT_FOUND, 'Tunnel not found')
    return record
  }

  private ensureRuntime(id: string): TunnelRuntime {
    let runtime = this.runtimes.get(id)
    if (!runtime) {
      runtime = createRuntime()
      this.runtimes.set(id, runtime)
    }
    return runtime
  }

  private toDto(record: TunnelRecord): Tunnel {
    const runtime = this.runtimes.get(record.id)
    return {
      ...record,
      status: runtime?.status ?? record.status,
      publicUrl: runtime?.publicUrl ?? record.publicUrl,
      cloudflaredPid: runtime?.pid ?? record.cloudflaredPid,
      startedAt: runtime?.startedAt ?? record.startedAt,
      lastError: runtime?.lastError ?? record.lastError
    }
  }

  private handleExit(id: string, info: ProcessExitInfo): void {
    const runtime = this.runtimes.get(id)
    if (!runtime) return
    const record = this.deps.repository.get(id)

    runtime.process = null
    runtime.pid = null
    if (runtime.sessionId) {
      this.deps.sessions.finish(runtime.sessionId, {
        status: info.expected ? 'stopped' : info.code === 0 ? 'exited' : 'crashed',
        exitCode: info.code
      })
      runtime.sessionId = null
    }

    if (info.expected || this.shuttingDown) {
      if (runtime.status !== 'error') {
        runtime.status = 'stopped'
        runtime.startedAt = null
        if (record?.tunnelType === 'quick') runtime.publicUrl = null
      }
    } else {
      const detail =
        info.code !== null
          ? `exit code ${info.code}`
          : info.signal
            ? `signal ${info.signal}`
            : 'unknown reason'
      const lastErrorLine = [...runtime.recentOutput]
        .reverse()
        .find((line) => /\bERR|error|failed|denied\b/i.test(line))
      runtime.status = 'error'
      runtime.startedAt = null
      runtime.lastError =
        `cloudflared exited unexpectedly (${detail}).` +
        (lastErrorLine ? ` ${lastErrorLine.slice(0, 500)}` : ' Check the tunnel logs.')
      if (record) {
        this.log(id, 'error', runtime.lastError)
        this.recordActivity(
          'error',
          `Tunnel "${record.tunnelName ?? record.id}" stopped unexpectedly (${detail})`,
          id,
          record.applicationId
        )
        this.deps.events.toast({
          type: 'error',
          title: 'Tunnel stopped unexpectedly',
          description: runtime.lastError
        })
      }
    }

    if (record) {
      this.persist(id, {
        status: runtime.status,
        cloudflaredPid: null,
        startedAt: runtime.startedAt,
        publicUrl: runtime.publicUrl,
        lastError: runtime.lastError
      })
    }
    this.broadcast()
  }

  private persist(
    id: string,
    patch: Parameters<TunnelsRepository['update']>[1]
  ): TunnelRecord | null {
    return this.deps.repository.update(id, patch)
  }

  private log(
    tunnelId: string,
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    stream: 'stdout' | 'stderr' | 'system' = 'system'
  ): void {
    this.deps.logs.log({ source: 'tunnel', level, message, tunnelId, stream })
  }

  private recordActivity(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    tunnelId: string | null,
    applicationId: string | null
  ): void {
    const entry = this.deps.activity.insert({
      applicationId,
      tunnelId,
      level,
      message
    })
    this.deps.events.activity(entry)
  }

  private broadcast(): void {
    this.deps.events.tunnelsChanged(this.list())
  }
}
