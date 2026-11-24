import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppUpdateStatus } from '@shared/types'
import { APP_VERSION_FALLBACK, GITHUB_REPO } from '@shared/constants'
import { AppError, ErrorCode, toErrorMessage } from '@shared/errors'
import { isNewerVersion } from '../tunnel-manager/url-detector'
import type { EventBus } from '../event-bus'
import type { LogManager } from '../log-manager'

export interface AppUpdaterDeps {
  events: EventBus
  logs: LogManager
  beforeInstall?: () => void
}

/**
 * Manages application auto-updates backed by GitHub Releases.
 * - Packaged NSIS installer: full electron-updater check, download, and quitAndInstall().
 * - Packaged Portable exe or development mode: checks GitHub Releases API and opens the release page.
 */
export class AppUpdaterService {
  private status: AppUpdateStatus
  private readonly canAutoInstall: boolean
  private initialized = false
  private checkPromise: Promise<AppUpdateStatus> | null = null

  constructor(private readonly deps: AppUpdaterDeps) {
    const isPortable = Boolean(process.env['PORTABLE_EXECUTABLE_FILE'])
    this.canAutoInstall = app.isPackaged && !isPortable
    this.status = {
      state: 'idle',
      currentVersion: app.getVersion() || APP_VERSION_FALLBACK,
      availableVersion: null,
      releaseDate: null,
      releaseUrl: GITHUB_REPO.releasesUrl,
      progress: null,
      message: null,
      lastCheckedAt: null,
      canAutoInstall: this.canAutoInstall
    }

    if (this.canAutoInstall) {
      this.setupElectronUpdater()
    }
  }

  private setupElectronUpdater(): void {
    if (this.initialized) return
    this.initialized = true

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false

    autoUpdater.on('checking-for-update', () => {
      this.updateStatus({ state: 'checking', message: 'Checking GitHub Releases…', progress: null })
    })

    autoUpdater.on('update-available', (info) => {
      this.updateStatus({
        state: 'available',
        availableVersion: info.version,
        releaseDate: info.releaseDate ?? null,
        releaseUrl: `${GITHUB_REPO.releasesUrl}/tag/v${info.version}`,
        progress: null,
        message: `Version v${info.version} is available.`,
        lastCheckedAt: new Date().toISOString()
      })
      this.deps.logs.log({
        source: 'system',
        level: 'info',
        message: `App update available: v${info.version}`
      })
    })

    autoUpdater.on('update-not-available', () => {
      this.updateStatus({
        state: 'not-available',
        availableVersion: null,
        progress: null,
        message: `You are running the latest version (v${this.status.currentVersion}).`,
        lastCheckedAt: new Date().toISOString()
      })
    })

    autoUpdater.on('download-progress', (progress) => {
      this.updateStatus({
        state: 'downloading',
        progress: {
          percent: Math.round(progress.percent),
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: progress.bytesPerSecond
        },
        message: `Downloading v${this.status.availableVersion ?? ''} (${Math.round(progress.percent)}%)…`
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      this.updateStatus({
        state: 'downloaded',
        availableVersion: info.version,
        progress: { percent: 100, transferred: 1, total: 1, bytesPerSecond: 0 },
        message: `v${info.version} is ready to install. Restart to apply the update.`
      })
      this.deps.logs.log({
        source: 'system',
        level: 'info',
        message: `App update v${info.version} downloaded and ready to install.`
      })
      this.deps.events.toast({
        type: 'success',
        title: `Update v${info.version} ready`,
        description: 'Open Settings → About & Updates to restart and install.'
      })
    })

    autoUpdater.on('error', (error) => {
      const message = toErrorMessage(error)
      this.updateStatus({
        state: 'error',
        progress: null,
        message,
        lastCheckedAt: new Date().toISOString()
      })
      this.deps.logs.log({
        source: 'system',
        level: 'warn',
        message: `Auto-updater error: ${message}`
      })
    })
  }

  getStatus(): AppUpdateStatus {
    return { ...this.status }
  }

  async check(options: { silent?: boolean } = {}): Promise<AppUpdateStatus> {
    if (this.checkPromise) return this.checkPromise
    const promise = this.doCheck(Boolean(options.silent)).finally(() => {
      this.checkPromise = null
    })
    this.checkPromise = promise
    return promise
  }

  private async doCheck(silent: boolean): Promise<AppUpdateStatus> {
    this.updateStatus({ state: 'checking', message: 'Checking for updates…', progress: null })

    if (this.canAutoInstall) {
      try {
        await autoUpdater.checkForUpdates()
        if (silent && this.status.state === 'available' && this.status.availableVersion) {
          this.deps.events.toast({
            type: 'info',
            title: `Update v${this.status.availableVersion} available`,
            description: 'Open Settings → About & Updates to download it.'
          })
        }
        return this.getStatus()
      } catch (error) {
        // Fallback to GitHub Releases API if latest.yml is not yet published.
        const fallback = await this.checkGitHubReleases(silent)
        if (fallback.state !== 'error') return fallback
        if (!silent) {
          throw new AppError(ErrorCode.NETWORK_ERROR, toErrorMessage(error))
        }
        return this.getStatus()
      }
    }

    return this.checkGitHubReleases(silent)
  }

  private async checkGitHubReleases(silent: boolean): Promise<AppUpdateStatus> {
    try {
      const response = await fetch(GITHUB_REPO.releasesApi, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `LocalAppManager/${this.status.currentVersion}`
        },
        signal: AbortSignal.timeout(15_000)
      })

      if (response.status === 404) {
        this.updateStatus({
          state: 'not-available',
          availableVersion: null,
          releaseUrl: GITHUB_REPO.releasesUrl,
          message: 'No GitHub Releases published yet.',
          lastCheckedAt: new Date().toISOString()
        })
        return this.getStatus()
      }

      if (!response.ok) {
        throw new Error(`GitHub returned HTTP ${response.status}`)
      }

      const data = (await response.json()) as {
        tag_name?: string
        html_url?: string
        published_at?: string
      }
      const latest = data.tag_name?.replace(/^v/i, '').trim() ?? null
      const releaseUrl = data.html_url || GITHUB_REPO.releasesUrl

      if (latest && isNewerVersion(latest, this.status.currentVersion)) {
        this.updateStatus({
          state: 'available',
          availableVersion: latest,
          releaseDate: data.published_at ?? null,
          releaseUrl,
          progress: null,
          message: this.canAutoInstall
            ? `Version v${latest} is available.`
            : `Version v${latest} is available on GitHub Releases.`,
          lastCheckedAt: new Date().toISOString()
        })
        if (silent) {
          this.deps.events.toast({
            type: 'info',
            title: `Update v${latest} available`,
            description: 'Open Settings → About & Updates to download it.'
          })
        }
      } else {
        this.updateStatus({
          state: 'not-available',
          availableVersion: null,
          releaseUrl,
          progress: null,
          message: `You are running the latest version (v${this.status.currentVersion}).`,
          lastCheckedAt: new Date().toISOString()
        })
      }
      return this.getStatus()
    } catch (error) {
      const message = `Could not check for updates: ${toErrorMessage(error)}`
      this.updateStatus({
        state: 'error',
        progress: null,
        message,
        lastCheckedAt: new Date().toISOString()
      })
      if (!silent) {
        throw new AppError(ErrorCode.NETWORK_ERROR, message)
      }
      return this.getStatus()
    }
  }

  async download(): Promise<AppUpdateStatus> {
    if (!this.canAutoInstall) {
      await this.openReleasePage()
      return this.getStatus()
    }
    if (this.status.state !== 'available') {
      await this.check()
    }
    if (this.status.state !== 'available') {
      return this.getStatus()
    }
    try {
      this.updateStatus({ state: 'downloading', message: 'Starting download…' })
      await autoUpdater.downloadUpdate()
      return this.getStatus()
    } catch (error) {
      const message = `Could not download update: ${toErrorMessage(error)}`
      this.updateStatus({ state: 'error', progress: null, message })
      throw new AppError(ErrorCode.NETWORK_ERROR, message)
    }
  }

  install(): void {
    if (!this.canAutoInstall || this.status.state !== 'downloaded') {
      throw new AppError(
        ErrorCode.INVALID_STATE,
        'No downloaded update is ready to install. Download an update first.'
      )
    }
    this.deps.beforeInstall?.()
    autoUpdater.quitAndInstall(false, true)
  }

  async openReleasePage(): Promise<void> {
    const url = this.status.releaseUrl || GITHUB_REPO.releasesUrl
    await shell.openExternal(url)
  }

  private updateStatus(patch: Partial<AppUpdateStatus>): void {
    this.status = { ...this.status, ...patch }
    this.deps.events.updaterStatus(this.status)
  }
}
