import type { Application, Tunnel, WorkflowProgress } from '@shared/types'
import { AppError, ErrorCode, toErrorMessage } from '@shared/errors'
import { effectiveHost, type ApplicationManager } from '../application-manager'
import type { TunnelManager } from '../tunnel-manager'
import type { SettingsService } from '../settings'
import type { EventBus } from '../event-bus'
import type { LogManager } from '../log-manager'
import type { ActivityRepository } from '../database/repositories/activity-logs'
import { checkHttpHealth } from '../health-check'

export interface WorkflowDeps {
  applications: ApplicationManager
  tunnels: TunnelManager
  settings: SettingsService
  events: EventBus
  logs: LogManager
  activity: ActivityRepository
}

/**
 * Orchestrates the combined "Start & Expose" workflow. Tunnel startup only
 * happens after the local application is verified healthy.
 */
export class WorkflowService {
  constructor(private readonly deps: WorkflowDeps) {}

  async startAndExpose(applicationId: string): Promise<{ application: Application; tunnel: Tunnel }> {
    let step: WorkflowProgress['step'] = 'validate'
    let tunnelId: string | null = null

    const emit = (
      status: WorkflowProgress['status'],
      message: string,
      progress: number
    ): void => {
      this.deps.events.workflow({
        applicationId,
        tunnelId,
        step,
        status,
        message,
        progress
      })
    }

    try {
      emit('running', 'Validating application configuration...', 5)
      const record = this.deps.applications.getRecord(applicationId)
      let application = this.deps.applications.get(applicationId)

      step = 'port-check'
      if (record.localPort !== null) {
        emit('running', `Checking port ${record.localPort}...`, 15)
        if (application.pid === null) {
          const port = await this.deps.applications.checkPort(record.localHost, record.localPort)
          if (port.inUse) {
            throw new AppError(
              ErrorCode.PORT_IN_USE,
              `Port ${record.localPort} is already in use${port.processName ? ` by ${port.processName}` : ''}. ` +
                'Stop that process or change the application port.'
            )
          }
        }
      } else {
        emit('running', 'Port will be auto-detected on startup...', 15)
      }

      step = 'start-application'
      if (application.pid === null) {
        emit('running', `Starting ${application.name}...`, 30)
        application = await this.deps.applications.start(applicationId)
      } else {
        emit('success', `${application.name} is already running.`, 40)
      }

      step = 'health-check'
      emit('running', 'Waiting for the application to respond...', 55)
      const port = application.localPort ?? application.detectedPort
      if (port === null) {
        throw new AppError(
          ErrorCode.HEALTH_CHECK_FAILED,
          'Could not determine a listening port for the application. Check the application logs.'
        )
      }
      const protocol = this.deps.settings.get().defaultProtocol
      const health = await checkHttpHealth({
        host: effectiveHost(record.localHost),
        port,
        protocol,
        timeoutMs: 5_000
      })
      if (!health.healthy) {
        throw new AppError(
          ErrorCode.HEALTH_CHECK_FAILED,
          `The application is not responding at ${application.localUrl ?? `${effectiveHost(record.localHost)}:${port}`} (${health.error ?? 'no response'}). ` +
            'The tunnel was not created. Check the application logs.'
        )
      }

      step = 'start-tunnel'
      emit('running', 'Preparing the Cloudflare tunnel...', 70)
      const existing = this.deps.tunnels.listForApplication(applicationId)
      const preferred =
        this.deps.settings.get().defaultTunnelType === 'named'
          ? existing.find((tunnel) => tunnel.tunnelType === 'named') ??
            existing.find((tunnel) => tunnel.tunnelType === 'quick')
          : existing.find((tunnel) => tunnel.tunnelType === 'quick') ??
            existing.find((tunnel) => tunnel.tunnelType === 'named')

      let tunnel = preferred ?? (await this.deps.tunnels.createQuick({ applicationId }))
      tunnelId = tunnel.id

      if (tunnel.status !== 'running') {
        emit('running', 'Starting the tunnel...', 80)
        tunnel = await this.deps.tunnels.start(tunnel.id)
      }

      step = 'detect-url'
      emit('running', 'Waiting for the public URL...', 92)
      if (!tunnel.publicUrl) {
        throw new AppError(
          ErrorCode.TUNNEL_URL_TIMEOUT,
          'The tunnel started but no public URL was detected. Open the tunnel logs for details.'
        )
      }

      step = 'complete'
      emit('success', `Public URL: ${tunnel.publicUrl}`, 100)
      this.deps.activity.insert({
        applicationId,
        tunnelId: tunnel.id,
        level: 'info',
        message: `Start & Expose completed: ${tunnel.publicUrl}`
      })
      this.deps.logs.log({
        source: 'system',
        level: 'info',
        message: `Start & Expose completed for "${application.name}": ${tunnel.publicUrl}`
      })
      this.deps.events.toast({
        type: 'success',
        title: 'Application is publicly available',
        description: tunnel.publicUrl
      })

      return { application: this.deps.applications.get(applicationId), tunnel: this.deps.tunnels.get(tunnel.id) }
    } catch (error) {
      const message = toErrorMessage(error)
      const tunnelFailure = tunnelId !== null
      const displayMessage = tunnelFailure
        ? `The application is running, but the tunnel failed: ${message}`
        : message
      emit('error', displayMessage, 0)
      this.deps.logs.log({
        source: 'system',
        level: 'error',
        message: `Start & Expose failed: ${displayMessage}`
      })
      if (error instanceof AppError) throw error
      throw new AppError(
        tunnelFailure ? ErrorCode.TUNNEL_START_FAILED : ErrorCode.INTERNAL,
        displayMessage
      )
    }
  }

  async stopEverything(applicationId: string): Promise<Application> {
    const application = this.deps.applications.get(applicationId)
    this.deps.logs.log({
      source: 'system',
      level: 'info',
      message: `Stopping all tunnels and the application for "${application.name}"...`
    })
    // Tunnels are stopped first so no public route points at a dead origin.
    await this.deps.tunnels.stopForApplication(applicationId)
    const stopped = await this.deps.applications.stop(applicationId)
    this.deps.activity.insert({
      applicationId,
      tunnelId: null,
      level: 'info',
      message: `Stopped everything for "${application.name}"`
    })
    return stopped
  }

  async deleteApplication(applicationId: string): Promise<void> {
    await this.stopEverything(applicationId)
    await this.deps.applications.remove(applicationId)
    await this.deps.tunnels.handleApplicationDeleted(applicationId)
  }
}
