import { isAbsolute } from 'node:path'
import { shell } from 'electron'
import type {
  Application,
  ApplicationInput,
  ApplicationStatus,
  HealthStatus,
  LocalProtocol,
  PortCheckResult
} from '@shared/types'
import { MASKED_SECRET, SENSITIVE_ENV_KEY_PATTERN } from '@shared/constants'
import { applicationInputSchema, formatZodError } from '@shared/validation'
import { AppError, ErrorCode, toErrorMessage } from '@shared/errors'
import type { ApplicationRecord } from '../database/records'
import type {
  ApplicationsRepository,
  ApplicationCreateInput
} from '../database/repositories/applications'
import type { ProcessSessionsRepository } from '../database/repositories/process-sessions'
import type { ActivityRepository } from '../database/repositories/activity-logs'
import type { SettingsService } from '../settings'
import type { LogManager } from '../log-manager'
import type { EventBus } from '../event-bus'
import type { SecretCodec } from '../secure-store'
import { ManagedProcess, type ProcessExitInfo } from '../process-manager'
import { killProcessTree, spawnShellCommand } from '../process-manager/tree-kill'
import { checkHttpHealth, waitForHealth } from '../health-check'
import { detectLogLevel } from '../log-manager'
import { isPortInUse } from '../../utils/net'
import {
  findListeningPortsForProcessTree,
  findPortOwner,
  getListeningPortNumbers
} from '../../utils/port-info'
import { isDirectory } from '../../utils/paths'
import { LogPortDetector, waitForAutoDetectedPort } from './port-detector'

interface RuntimeState {
  process: ManagedProcess | null
  status: ApplicationStatus
  health: HealthStatus
  pid: number | null
  detectedPort: number | null
  startedAt: string | null
  lastError: string | null
  sessionId: string | null
  startPromise: Promise<Application> | null
  stopPromise: Promise<Application> | null
}

export interface ApplicationManagerDeps {
  repository: ApplicationsRepository
  sessions: ProcessSessionsRepository
  activity: ActivityRepository
  settings: SettingsService
  logs: LogManager
  events: EventBus
  codec: SecretCodec
}

function createRuntime(): RuntimeState {
  return {
    process: null,
    status: 'stopped',
    health: 'unknown',
    pid: null,
    detectedPort: null,
    startedAt: null,
    lastError: null,
    sessionId: null,
    startPromise: null,
    stopPromise: null
  }
}

export function effectiveHost(host: string): string {
  return host === '0.0.0.0' || host === '::' || host === '[::]' ? '127.0.0.1' : host
}

export function isSensitiveEnvironmentKey(key: string): boolean {
  return SENSITIVE_ENV_KEY_PATTERN.test(key)
}

export class ApplicationManager {
  private readonly runtimes = new Map<string, RuntimeState>()
  private healthTimer: NodeJS.Timeout | null = null
  private healthCheckRunning = false
  private shuttingDown = false

  constructor(private readonly deps: ApplicationManagerDeps) {
    this.restartHealthMonitor()
  }

  // ---------------------------------------------------------------- queries

  list(): Application[] {
    return this.deps.repository.list().map((record) => this.toDto(record))
  }

  get(id: string): Application {
    return this.toDto(this.requireRecord(id))
  }

  getRecord(id: string): ApplicationRecord {
    return this.requireRecord(id)
  }

  getEffectivePort(id: string): number | null {
    const record = this.deps.repository.get(id)
    if (!record) return null
    return record.localPort ?? this.runtimes.get(id)?.detectedPort ?? null
  }

  getLocalUrl(record: ApplicationRecord): string | null {
    const port = record.localPort ?? this.runtimes.get(record.id)?.detectedPort ?? null
    if (port === null) return null
    const protocol = this.deps.settings.get().defaultProtocol
    return `${protocol}://${effectiveHost(record.localHost)}:${port}`
  }

  async checkPort(host: string, port: number): Promise<PortCheckResult> {
    const inUse = await isPortInUse(effectiveHost(host), port, 1_200)
    if (!inUse) {
      return { host, port, inUse: false, available: true, processName: null }
    }
    const owner = await findPortOwner(port)
    return {
      host,
      port,
      inUse: true,
      available: false,
      processName: owner ? `${owner.name} (PID ${owner.pid})` : null
    }
  }

  // ------------------------------------------------------------------ CRUD

  create(input: ApplicationInput): Application {
    const validated = this.validateInput(input)
    const encoded = this.encodeEnvironment(validated.environmentVariables)
    const created = this.deps.repository.create({
      ...this.toCreateInput(validated),
      environmentVariables: encoded
    })
    this.recordActivity('info', `Application "${created.name}" was added`, created.id)
    this.deps.logs.log({
      source: 'system',
      level: 'info',
      message: `Application "${created.name}" was added`
    })
    this.broadcast()
    return this.toDto(created)
  }

  update(id: string, input: ApplicationInput): Application {
    const existing = this.requireRecord(id)
    const runtime = this.runtimes.get(id)
    if (runtime?.process?.running) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'Stop the application before changing its configuration.'
      )
    }
    const validated = this.validateInput(input)
    const encoded = this.encodeEnvironment(validated.environmentVariables, existing.environmentVariables)
    const updated = this.deps.repository.update(id, {
      ...this.toCreateInput(validated),
      environmentVariables: encoded
    })
    if (!updated) throw new AppError(ErrorCode.NOT_FOUND, 'Application not found')
    this.runtimes.delete(id)
    this.recordActivity('info', `Application "${updated.name}" was updated`, updated.id)
    this.broadcast()
    return this.toDto(updated)
  }

  duplicate(id: string): Application {
    const source = this.requireRecord(id)
    const suffix = ' (Copy)'
    const baseName = source.name.slice(0, 80 - suffix.length)
    const created = this.deps.repository.create({
      name: `${baseName}${suffix}`,
      projectName: source.projectName,
      description: source.description,
      projectDirectory: source.projectDirectory,
      workingDirectory: source.workingDirectory,
      applicationType: source.applicationType,
      startCommand: source.startCommand,
      stopCommand: source.stopCommand,
      localHost: source.localHost,
      localPort: source.localPort,
      environmentVariables: source.environmentVariables,
      autoStart: false
    })
    this.recordActivity('info', `Application "${source.name}" was duplicated`, created.id)
    this.broadcast()
    return this.toDto(created)
  }

  reorder(ids: string[]): Application[] {
    this.deps.repository.reorder(ids)
    this.broadcast()
    return this.list()
  }

  async remove(id: string): Promise<void> {
    const record = this.requireRecord(id)
    await this.stop(id, { timeoutMs: 4_000 }).catch(() => undefined)
    this.deps.repository.delete(id)
    this.runtimes.delete(id)
    this.recordActivity('info', `Application "${record.name}" was deleted`, null)
    this.broadcast()
  }

  // -------------------------------------------------------------- lifecycle

  async start(id: string): Promise<Application> {
    const runtime = this.ensureRuntime(id)
    if (runtime.process?.running) {
      return this.get(id)
    }
    if (runtime.startPromise) return runtime.startPromise

    const promise = this.doStart(id, runtime).finally(() => {
      runtime.startPromise = null
    })
    runtime.startPromise = promise
    return promise
  }

  private async doStart(id: string, runtime: RuntimeState): Promise<Application> {
    const record = this.requireRecord(id)
    this.assertDirectory(record.projectDirectory, 'Project directory')
    this.assertDirectory(record.workingDirectory || record.projectDirectory, 'Working directory')

    const settings = this.deps.settings.get()
    const host = effectiveHost(record.localHost)
    if (record.localPort !== null && (await isPortInUse(host, record.localPort, 1_200))) {
      const owner = await findPortOwner(record.localPort)
      const ownerText = owner ? ` by ${owner.name} (PID ${owner.pid})` : ''
      const message = `Port ${record.localPort} is already in use${ownerText}. Stop that process or choose a different port.`
      runtime.status = 'error'
      runtime.lastError = message
      runtime.health = 'unknown'
      this.logApp(id, 'error', message)
      this.broadcast()
      throw new AppError(ErrorCode.PORT_IN_USE, message)
    }

    const environment = this.decodeEnvironment(record)
    let preExistingPorts: Set<number> | null = null
    let logDetector: LogPortDetector | null = null

    if (record.localPort !== null) {
      environment.PORT = environment.PORT ?? String(record.localPort)
    } else {
      preExistingPorts = await getListeningPortNumbers()
      logDetector = new LogPortDetector()
      const configuredPort = Number(environment.PORT)
      if (Number.isInteger(configuredPort) && configuredPort >= 1 && configuredPort <= 65_535) {
        logDetector.addCandidate(configuredPort)
      }
    }

    runtime.status = 'starting'
    runtime.health = 'unknown'
    runtime.detectedPort = null
    runtime.lastError = null
    runtime.startedAt = null
    this.logApp(id, 'info', `Starting "${record.name}" with command: ${record.startCommand}`)
    this.broadcast()

    const managed = new ManagedProcess({
      id,
      label: `Application "${record.name}"`,
      command: record.startCommand,
      cwd: record.workingDirectory || record.projectDirectory,
      env: environment,
      onLine: (line, stream) => {
        logDetector?.push(line)
        this.logApp(
          id,
          stream === 'stderr' ? detectLogLevel(line, 'warn') : detectLogLevel(line, 'info'),
          line,
          stream
        )
      },
      onSpawn: (pid) => {
        runtime.pid = pid
        runtime.sessionId = this.deps.sessions.start({
          applicationId: id,
          tunnelId: null,
          processType: 'application',
          pid
        })
        this.broadcast()
      },
      onExit: (info) => this.handleExit(id, info),
      onError: (error) => {
        this.logApp(id, 'error', error.message)
      }
    })

    runtime.process = managed
    try {
      managed.spawn()
    } catch (error) {
      runtime.process = null
      runtime.status = 'error'
      runtime.lastError = toErrorMessage(error)
      this.recordActivity('error', `Failed to start "${record.name}": ${runtime.lastError}`, id)
      this.broadcast()
      throw error
    }

    if (record.localPort !== null) {
      const result = await waitForHealth({
        host,
        port: record.localPort,
        protocol: settings.defaultProtocol,
        timeoutMs: settings.appStartupTimeoutMs,
        intervalMs: 1_000,
        shouldAbort: () => !managed.running || runtime.status === 'stopping'
      })

      if (!managed.running) {
        const message =
          runtime.lastError ??
          'The application process exited before it became ready. Check the application logs.'
        runtime.status = 'error'
        runtime.lastError = message
        this.broadcast()
        throw new AppError(ErrorCode.PROCESS_START_FAILED, message)
      }

      if (!result.healthy) {
        const message =
          `The application did not respond on ${this.getLocalUrl(record)} within ` +
          `${Math.round(settings.appStartupTimeoutMs / 1_000)} seconds. ` +
          `${result.lastResult?.error ?? ''} The process is still running; check the logs.`.trim()
        runtime.status = 'error'
        runtime.health = 'unhealthy'
        runtime.lastError = message
        this.logApp(id, 'error', message)
        this.recordActivity('warn', `Health check failed for "${record.name}"`, id)
        this.broadcast()
        throw new AppError(ErrorCode.HEALTH_CHECK_TIMEOUT, message)
      }
    } else {
      const detected = await waitForAutoDetectedPort({
        host,
        protocol: settings.defaultProtocol,
        timeoutMs: settings.appStartupTimeoutMs,
        intervalMs: 1_000,
        getPid: () => managed.pid,
        logDetector: logDetector!,
        preExistingPorts: preExistingPorts!,
        shouldAbort: () => !managed.running || runtime.status === 'stopping'
      })

      if (!managed.running) {
        const message =
          runtime.lastError ??
          'The application process exited before it became ready. Check the application logs.'
        runtime.status = 'error'
        runtime.lastError = message
        this.broadcast()
        throw new AppError(ErrorCode.PROCESS_START_FAILED, message)
      }

      if (!detected.healthy || detected.port === null) {
        const message =
          `Could not auto-detect a listening port for "${record.name}" within ` +
          `${Math.round(settings.appStartupTimeoutMs / 1_000)} seconds. ` +
          'The process is still running; check the logs or set a Local Port manually.'
        runtime.status = 'error'
        runtime.health = 'unhealthy'
        runtime.lastError = message
        this.logApp(id, 'error', message)
        this.recordActivity('warn', `Port auto-detection timed out for "${record.name}"`, id)
        this.broadcast()
        throw new AppError(ErrorCode.HEALTH_CHECK_TIMEOUT, message)
      }

      runtime.detectedPort = detected.port
      this.logApp(id, 'info', `Auto-detected port ${detected.port} for "${record.name}"`)
    }

    const resolvedPort = record.localPort ?? runtime.detectedPort
    runtime.status = 'running'
    runtime.health = 'healthy'
    runtime.startedAt = new Date().toISOString()
    runtime.lastError = null
    this.logApp(id, 'info', `"${record.name}" is running at ${this.getLocalUrl(record)}`)
    this.recordActivity('info', `Application "${record.name}" started on port ${resolvedPort}`, id)
    this.broadcast()
    return this.get(id)
  }

  async stop(id: string, options: { timeoutMs?: number } = {}): Promise<Application> {
    const runtime = this.ensureRuntime(id)
    if (runtime.stopPromise) return runtime.stopPromise
    if (!runtime.process?.running) {
      if (runtime.status !== 'error') runtime.status = 'stopped'
      runtime.pid = null
      runtime.startedAt = null
      this.broadcast()
      return this.get(id)
    }

    const promise = this.doStop(id, runtime, options.timeoutMs).finally(() => {
      runtime.stopPromise = null
    })
    runtime.stopPromise = promise
    return promise
  }

  private async doStop(id: string, runtime: RuntimeState, timeoutMs?: number): Promise<Application> {
    const record = this.requireRecord(id)
    const settings = this.deps.settings.get()
    const process = runtime.process
    if (!process) return this.get(id)

    runtime.status = 'stopping'
    this.logApp(id, 'info', `Stopping "${record.name}"...`)
    this.broadcast()

    if (record.stopCommand) {
      this.logApp(id, 'info', `Running stop command: ${record.stopCommand}`)
      await this.runStopCommand(
        record.stopCommand,
        record.workingDirectory || record.projectDirectory,
        this.decodeEnvironment(record),
        Math.min(10_000, timeoutMs ?? settings.processTerminationTimeoutMs)
      ).catch((error: unknown) => {
        this.logApp(id, 'warn', `Stop command failed: ${toErrorMessage(error)}`)
      })
    }

    await process.stop(timeoutMs ?? settings.processTerminationTimeoutMs)

    runtime.status = 'stopped'
    runtime.health = 'unknown'
    runtime.startedAt = null
    runtime.pid = null
    runtime.detectedPort = null
    runtime.lastError = null
    this.logApp(id, 'info', `"${record.name}" stopped`)
    this.recordActivity('info', `Application "${record.name}" stopped`, id)
    this.broadcast()
    return this.get(id)
  }

  async restart(id: string): Promise<Application> {
    await this.stop(id)
    return this.start(id)
  }

  private handleExit(id: string, info: ProcessExitInfo): void {
    const runtime = this.runtimes.get(id)
    if (!runtime) return
    const record = this.deps.repository.get(id)

    runtime.process = null
    runtime.pid = null
    runtime.detectedPort = null
    if (runtime.sessionId) {
      this.deps.sessions.finish(runtime.sessionId, {
        status: info.expected ? 'stopped' : info.code === 0 ? 'exited' : 'crashed',
        exitCode: info.code
      })
      runtime.sessionId = null
    }

    if (info.expected || this.shuttingDown) {
      runtime.status = 'stopped'
      runtime.health = 'unknown'
      runtime.startedAt = null
      if (record) this.logApp(id, 'info', `"${record.name}" stopped`)
    } else {
      const detail =
        info.code !== null
          ? `exit code ${info.code}`
          : info.signal
            ? `signal ${info.signal}`
            : 'unknown reason'
      runtime.status = 'error'
      runtime.health = 'unknown'
      runtime.startedAt = null
      runtime.lastError = `Process exited unexpectedly (${detail}). Check the application logs.`
      if (record) {
        this.logApp(id, 'error', runtime.lastError)
        this.recordActivity('error', `Application "${record.name}" crashed (${detail})`, id)
        this.deps.events.toast({
          type: 'error',
          title: 'Application stopped unexpectedly',
          description: `${record.name} exited with ${detail}.`
        })
      }
    }
    this.broadcast()
  }

  async startAutoStartApplications(): Promise<void> {
    const candidates = this.deps.repository.list().filter((record) => record.autoStart)
    for (const record of candidates) {
      if (this.shuttingDown) return
      try {
        await this.start(record.id)
      } catch (error) {
        this.deps.logs.log({
          source: 'system',
          level: 'warn',
          message: `Auto-start failed for "${record.name}": ${toErrorMessage(error)}`
        })
      }
      await new Promise((resolve) => setTimeout(resolve, 750))
    }
  }

  // ----------------------------------------------------------------- health

  applySettings(): void {
    this.restartHealthMonitor()
  }

  private restartHealthMonitor(): void {
    this.stopHealthMonitor()
    if (this.shuttingDown) return
    const interval = Math.max(5_000, this.deps.settings.get().healthCheckIntervalMs)
    this.healthTimer = setInterval(() => {
      void this.runHealthChecks()
    }, interval)
    this.healthTimer.unref?.()
  }

  private stopHealthMonitor(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
  }

  private async runHealthChecks(): Promise<void> {
    if (this.healthCheckRunning || this.shuttingDown) return
    this.healthCheckRunning = true
    try {
      const protocol = this.deps.settings.get().defaultProtocol
      let changed = false
      const targets: Array<{ id: string; runtime: RuntimeState; record: ApplicationRecord; port: number }> = []

      for (const [id, runtime] of this.runtimes.entries()) {
        if (!runtime.process?.running) continue
        if (runtime.status !== 'running' && runtime.status !== 'error') continue
        const record = this.deps.repository.get(id)
        if (!record) continue
        const port = record.localPort ?? runtime.detectedPort
        if (port !== null) {
          targets.push({ id, runtime, record, port })
          continue
        }
        if (runtime.pid !== null) {
          const candidates = await findListeningPortsForProcessTree(runtime.pid)
          for (const candidatePort of candidates) {
            const probe = await checkHttpHealth({
              host: effectiveHost(record.localHost),
              port: candidatePort,
              protocol,
              timeoutMs: 2_000
            })
            if (probe.healthy) {
              runtime.detectedPort = candidatePort
              runtime.status = 'running'
              runtime.health = 'healthy'
              runtime.lastError = null
              this.logApp(id, 'info', `Auto-detected port ${candidatePort} for "${record.name}"`)
              changed = true
              break
            }
          }
        }
      }

      // Probe in parallel so one unresponsive app cannot delay the others.
      const results = await Promise.allSettled(
        targets.map((target) =>
          checkHttpHealth({
            host: effectiveHost(target.record.localHost),
            port: target.port,
            protocol,
            timeoutMs: 2_000
          })
        )
      )
      if (this.shuttingDown) return

      for (let index = 0; index < results.length; index += 1) {
        const result = results[index]
        const target = targets[index]
        if (!target || !result || result.status === 'rejected') continue
        const { id, runtime, record, port } = target
        const nextHealth: HealthStatus = result.value.healthy ? 'healthy' : 'unhealthy'

        if (!result.value.healthy && record.localPort === null && runtime.pid !== null && runtime.process?.running) {
          const treePorts = await findListeningPortsForProcessTree(runtime.pid)
          let reboundPort: number | null = null
          for (const candidatePort of treePorts) {
            if (candidatePort === port) continue
            const probe = await checkHttpHealth({
              host: effectiveHost(record.localHost),
              port: candidatePort,
              protocol,
              timeoutMs: 2_000
            })
            if (probe.healthy) {
              reboundPort = candidatePort
              break
            }
          }
          if (reboundPort !== null) {
            runtime.detectedPort = reboundPort
            runtime.health = 'healthy'
            runtime.status = 'running'
            runtime.lastError = null
            this.logApp(
              id,
              'info',
              `Detected port change for "${record.name}": now listening on port ${reboundPort}`
            )
            changed = true
            continue
          }
        }

        if (nextHealth === runtime.health) continue

        runtime.health = nextHealth
        if (result.value.healthy) {
          runtime.status = 'running'
          runtime.lastError = null
          this.logApp(id, 'info', 'Application is responding again')
        } else {
          runtime.status = 'error'
          runtime.lastError = `Health check failed: ${result.value.error ?? 'no response from the application'}`
          this.logApp(id, 'error', runtime.lastError)
          this.recordActivity('warn', `Health check failed for "${record.name}"`, id)
        }
        changed = true
      }
      if (changed) this.broadcast()
    } finally {
      this.healthCheckRunning = false
    }
  }

  // ------------------------------------------------------------------ misc

  async openDirectory(id: string): Promise<void> {
    const record = this.requireRecord(id)
    if (!isDirectory(record.projectDirectory)) {
      throw new AppError(
        ErrorCode.DIRECTORY_NOT_FOUND,
        `Project directory does not exist: ${record.projectDirectory}`
      )
    }
    const error = await shell.openPath(record.projectDirectory)
    if (error) throw new AppError(ErrorCode.INTERNAL, `Could not open directory: ${error}`)
  }

  async openLocalUrl(id: string): Promise<void> {
    const record = this.requireRecord(id)
    const url = this.getLocalUrl(record)
    if (!url) {
      throw new AppError(
        ErrorCode.INVALID_STATE,
        'Port has not been detected yet. Start the application first.'
      )
    }
    await shell.openExternal(url)
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    this.stopHealthMonitor()
    const ids = [...this.runtimes.keys()]
    await Promise.allSettled(ids.map((id) => this.stop(id, { timeoutMs: 2_500 })))
    for (const runtime of this.runtimes.values()) {
      runtime.process?.forceKillSync()
    }
  }

  // --------------------------------------------------------------- private

  private requireRecord(id: string): ApplicationRecord {
    const record = this.deps.repository.get(id)
    if (!record) throw new AppError(ErrorCode.NOT_FOUND, 'Application not found')
    return record
  }

  private ensureRuntime(id: string): RuntimeState {
    let runtime = this.runtimes.get(id)
    if (!runtime) {
      runtime = createRuntime()
      this.runtimes.set(id, runtime)
    }
    return runtime
  }

  private toDto(record: ApplicationRecord): Application {
    const runtime = this.runtimes.get(record.id)
    const environmentVariables: Record<string, string> = {}
    for (const [key, value] of Object.entries(record.environmentVariables)) {
      if (isSensitiveEnvironmentKey(key)) {
        environmentVariables[key] = value ? MASKED_SECRET : ''
      } else {
        environmentVariables[key] = value
      }
    }
    return {
      id: record.id,
      name: record.name,
      projectName: record.projectName,
      description: record.description,
      projectDirectory: record.projectDirectory,
      workingDirectory: record.workingDirectory,
      applicationType: record.applicationType,
      startCommand: record.startCommand,
      stopCommand: record.stopCommand,
      localHost: record.localHost,
      localPort: record.localPort,
      environmentVariables,
      autoStart: record.autoStart,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      status: runtime?.status ?? 'stopped',
      health: runtime?.health ?? 'unknown',
      pid: runtime?.pid ?? null,
      detectedPort: runtime?.detectedPort ?? null,
      startedAt: runtime?.startedAt ?? null,
      lastError: runtime?.lastError ?? null,
      localUrl: this.getLocalUrl(record)
    }
  }

  private validateInput(input: ApplicationInput): ApplicationInput {
    const parsed = applicationInputSchema.safeParse(input)
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION, formatZodError(parsed.error))
    }
    const value = parsed.data
    if (!isAbsolute(value.projectDirectory)) {
      throw new AppError(ErrorCode.VALIDATION, 'Project directory must be an absolute path.')
    }
    if (!isDirectory(value.projectDirectory)) {
      throw new AppError(
        ErrorCode.DIRECTORY_NOT_FOUND,
        `Project directory does not exist: ${value.projectDirectory}`
      )
    }
    const workingDirectory = value.workingDirectory || value.projectDirectory
    if (!isAbsolute(workingDirectory)) {
      throw new AppError(ErrorCode.VALIDATION, 'Working directory must be an absolute path.')
    }
    if (!isDirectory(workingDirectory)) {
      throw new AppError(
        ErrorCode.DIRECTORY_NOT_FOUND,
        `Working directory does not exist: ${workingDirectory}`
      )
    }
    return { ...value, workingDirectory }
  }

  private toCreateInput(input: ApplicationInput): ApplicationCreateInput {
    return {
      name: input.name,
      projectName: input.projectName ?? '',
      description: input.description,
      projectDirectory: input.projectDirectory,
      workingDirectory: input.workingDirectory || input.projectDirectory,
      applicationType: input.applicationType,
      startCommand: input.startCommand,
      stopCommand: input.stopCommand,
      localHost: input.localHost,
      localPort: input.localPort,
      environmentVariables: input.environmentVariables,
      autoStart: input.autoStart
    }
  }

  private encodeEnvironment(
    environment: Record<string, string>,
    existing: Record<string, string> = {}
  ): Record<string, string> {
    const encoded: Record<string, string> = {}
    for (const [key, value] of Object.entries(environment)) {
      if (value === MASKED_SECRET) {
        const previous = existing[key]
        if (previous !== undefined) encoded[key] = previous
        continue
      }
      encoded[key] = isSensitiveEnvironmentKey(key) ? this.deps.codec.encrypt(value) : value
    }
    return encoded
  }

  private decodeEnvironment(record: ApplicationRecord): Record<string, string> {
    const decoded: Record<string, string> = {}
    for (const [key, value] of Object.entries(record.environmentVariables)) {
      try {
        decoded[key] = this.deps.codec.decrypt(value)
      } catch (error) {
        throw new AppError(
          ErrorCode.INTERNAL,
          `Could not decrypt environment variable "${key}". Edit the application and re-enter the value.`,
          toErrorMessage(error)
        )
      }
    }
    return decoded
  }

  private async runStopCommand(
    command: string,
    cwd: string,
    env: Record<string, string>,
    timeoutMs: number
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawnShellCommand(command, {
        cwd,
        env: { ...process.env, ...env, NO_COLOR: '1' }
      })
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      }
      const timer = setTimeout(() => {
        if (child.pid) void killProcessTree(child.pid, true)
        finish(new Error(`Stop command timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      timer.unref?.()
      child.on('error', (error) => finish(error))
      child.on('close', (code) => {
        if (code !== 0 && code !== null) finish(new Error(`Stop command exited with code ${code}`))
        else finish()
      })
    })
  }

  private logApp(
    id: string,
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    stream: 'stdout' | 'stderr' | 'system' = 'system'
  ): void {
    this.deps.logs.log({
      source: 'application',
      level,
      message,
      applicationId: id,
      stream
    })
  }

  private recordActivity(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    applicationId: string | null
  ): void {
    const entry = this.deps.activity.insert({
      applicationId,
      tunnelId: null,
      level,
      message
    })
    this.deps.events.activity(entry)
  }

  private broadcast(): void {
    this.deps.events.applicationsChanged(this.list())
  }

  private assertDirectory(directory: string, label: string): void {
    if (!isDirectory(directory)) {
      throw new AppError(ErrorCode.DIRECTORY_NOT_FOUND, `${label} does not exist: ${directory}`)
    }
  }
}
