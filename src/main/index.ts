import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, nativeTheme, session } from 'electron'
import { APP_ID, APP_NAME } from '@shared/constants'
import { AppError, toErrorMessage } from '@shared/errors'
import type { AppSettings } from '@shared/types'
import { createAppPaths, ensureDirectory } from './utils/paths'
import { Database } from './services/database'
import { ApplicationsRepository } from './services/database/repositories/applications'
import { TunnelsRepository } from './services/database/repositories/tunnels'
import { ProcessSessionsRepository } from './services/database/repositories/process-sessions'
import { ActivityRepository } from './services/database/repositories/activity-logs'
import { SettingsRepository } from './services/database/repositories/settings'
import { SettingsService } from './services/settings'
import { LogManager } from './services/log-manager'
import { EventBus } from './services/event-bus'
import { ElectronSecretCodec } from './services/secure-store'
import { ApplicationManager } from './services/application-manager'
import { TunnelManager } from './services/tunnel-manager'
import { CloudflaredManager } from './services/cloudflared-manager'
import { AppUpdaterService } from './services/updater'
import { WorkflowService } from './services/workflow'
import { createMainWindow } from './windows/main-window'
import { registerIpcHandlers, type IpcContext } from './ipc'
import { createTray, type TrayController } from './tray'
import { forceKillAllTrackedProcesses } from './services/process-manager'

app.setName(APP_NAME)
const appDataRoot = app.getPath('appData')
const targetUserData = join(appDataRoot, APP_NAME)
const legacyUserData = join(appDataRoot, 'Tunnel Manager')
// One-time migration from the previous "Tunnel Manager" data directory so existing
// applications, tunnels, settings and managed binaries are preserved.
if (!existsSync(join(targetUserData, 'data')) && existsSync(join(legacyUserData, 'data'))) {
  try {
    cpSync(join(legacyUserData, 'data'), join(targetUserData, 'data'), { recursive: true })
    if (existsSync(join(legacyUserData, 'bin'))) {
      cpSync(join(legacyUserData, 'bin'), join(targetUserData, 'bin'), { recursive: true })
    }
  } catch {
    // Non-fatal: fresh database will be created if legacy files are inaccessible.
  }
}
app.setPath('userData', targetUserData)

interface Runtime {
  db: Database
  settings: SettingsService
  logs: LogManager
  events: EventBus
  applications: ApplicationManager
  tunnels: TunnelManager
  cloudflared: CloudflaredManager
  workflow: WorkflowService
  paths: ReturnType<typeof createAppPaths>
}

let mainWindow: BrowserWindow | null = null
let trayController: TrayController | null = null
let runtime: Runtime | null = null
let isQuitting = false
let cleanupTimer: NodeJS.Timeout | null = null

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (!runtime) return
    mainWindow = createMainWindow({ show: true })
    attachWindowEvents(mainWindow)
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function attachWindowEvents(window: BrowserWindow): void {
  window.on('close', (event) => {
    if (isQuitting) return
    const settings = runtime?.settings.get()
    if (!settings?.minimizeToTray) return
    // Free the renderer (~120 MB) while staying alive in the tray. The window is
    // recreated on demand by showMainWindow().
    if (settings.destroyWindowOnHide) return
    event.preventDefault()
    window.hide()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })
}

function ensureTray(): void {
  if (!runtime || trayController) return
  trayController = createTray({
    getWindow: () => mainWindow,
    showWindow: showMainWindow,
    quit: () => app.quit(),
    applications: runtime.applications,
    tunnels: runtime.tunnels,
    settings: runtime.settings,
    events: runtime.events
  })
  if (!trayController) {
    runtime.logs.log({
      source: 'system',
      level: 'warn',
      message: 'System tray is unavailable because the tray icon could not be loaded.'
    })
  }
}

function destroyTray(): void {
  trayController?.destroy()
  trayController = null
}

function resolveLogDirectory(settings: AppSettings, fallback: string): string {
  const candidate = settings.logDirectory.trim()
  if (!candidate) return fallback
  try {
    return ensureDirectory(candidate)
  } catch {
    return fallback
  }
}

function applyLoginItemSettings(settings: AppSettings): void {
  if (process.platform !== 'win32' || !app.isPackaged) return
  app.setLoginItemSettings({
    openAtLogin: settings.launchOnStartup,
    args: settings.launchMinimized ? ['--hidden'] : []
  })
}

function applySettings(settings: AppSettings): void {
  nativeTheme.themeSource = settings.theme
  if (!runtime) return
  const logDirectory = resolveLogDirectory(settings, runtime.paths.logs)
  runtime.logs.configure(logDirectory, settings.maxLogEntries)
  runtime.applications.applySettings()
  applyLoginItemSettings(settings)
  if (settings.minimizeToTray) ensureTray()
  else destroyTray()
  trayController?.refreshMenu()
}

function setupSessionSecurity(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  session.defaultSession.setPermissionCheckHandler(() => false)

  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
              "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; " +
              "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
          ]
        }
      })
    })
  }

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.on('will-navigate', (event, url) => {
      const current = contents.getURL()
      if (url !== current) event.preventDefault()
    })
  })
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId(APP_ID)

  const userData = app.getPath('userData')
  ensureDirectory(userData)
  const paths = createAppPaths(userData)
  ensureDirectory(paths.logs)

  const db = new Database(paths.database)
  const applicationsRepository = new ApplicationsRepository(db)
  const tunnelsRepository = new TunnelsRepository(db)
  const sessionsRepository = new ProcessSessionsRepository(db)
  const activityRepository = new ActivityRepository(db)
  const settingsRepository = new SettingsRepository(db)
  const settings = new SettingsService(settingsRepository)
  const events = new EventBus()
  const initialSettings = settings.get()
  const logDirectory = resolveLogDirectory(initialSettings, paths.logs)
  const logs = new LogManager({
    directory: logDirectory,
    maxEntriesPerSource: initialSettings.maxLogEntries
  })
  logs.setOnEntry((entry) => events.log(entry))

  // Recover from a previous crash: no child process survived the last session.
  const orphaned = sessionsRepository.markOrphaned()
  tunnelsRepository.resetRuntimeState()
  if (orphaned > 0) {
    logs.log({
      source: 'system',
      level: 'warn',
      message: `Marked ${orphaned} process session(s) from a previous run as orphaned.`
    })
  }

  const codec = new ElectronSecretCodec()
  const cloudflared = new CloudflaredManager({ paths, settings, events, logs, activity: activityRepository })
  const applications = new ApplicationManager({
    repository: applicationsRepository,
    sessions: sessionsRepository,
    activity: activityRepository,
    settings,
    logs,
    events,
    codec
  })
  const tunnels = new TunnelManager({
    repository: tunnelsRepository,
    applications,
    sessions: sessionsRepository,
    activity: activityRepository,
    settings,
    logs,
    events,
    cloudflared,
    workingDirectory: paths.userData
  })
  const workflow = new WorkflowService({
    applications,
    tunnels,
    settings,
    events,
    logs,
    activity: activityRepository
  })
  const updater = new AppUpdaterService({
    events,
    logs,
    beforeInstall: () => {
      isQuitting = true
    }
  })

  runtime = { db, settings, logs, events, applications, tunnels, cloudflared, workflow, paths }

  setupSessionSecurity()
  nativeTheme.themeSource = initialSettings.theme
  applyLoginItemSettings(initialSettings)

  const ipcContext: IpcContext = {
    applications,
    tunnels,
    workflow,
    cloudflared,
    updater,
    settings,
    logs,
    activity: activityRepository,
    events,
    paths,
    getMainWindow: () => mainWindow
  }
  registerIpcHandlers(ipcContext)

  const startupUpdateTimer = setTimeout(() => {
    void updater.check({ silent: true }).catch(() => undefined)
  }, 10_000)
  startupUpdateTimer.unref?.()

  const startHidden =
    (initialSettings.launchMinimized || process.argv.includes('--hidden')) &&
    initialSettings.minimizeToTray
  mainWindow = createMainWindow({ show: !startHidden })
  attachWindowEvents(mainWindow)

  if (initialSettings.minimizeToTray) ensureTray()

  let previousSettings = initialSettings
  settings.onChange((next) => {
    try {
      applySettings(next)
    } catch (error) {
      logs.log({
        source: 'system',
        level: 'warn',
        message: `Could not apply settings: ${toErrorMessage(error)}`
      })
    }
    if (previousSettings.cloudflaredPath !== next.cloudflaredPath) {
      void cloudflared.refresh().catch(() => undefined)
    }
    previousSettings = next
  })

  if (initialSettings.autoCleanupLogs) {
    void logs.cleanup(initialSettings.logRetentionDays)
    cleanupTimer = setInterval(
      () => {
        void logs.cleanup(runtime?.settings.get().logRetentionDays ?? 14)
      },
      24 * 60 * 60 * 1_000
    )
    cleanupTimer.unref?.()
  }

  logs.log({
    source: 'system',
    level: 'info',
    message: `${APP_NAME} ${app.getVersion()} started (Electron ${process.versions.electron}).`
  })

  setTimeout(() => {
    if (!runtime || isQuitting) return
    void applications.startAutoStartApplications()
  }, 1_500).unref?.()
}

async function shutdown(): Promise<void> {
  if (isQuitting) return
  isQuitting = true
  if (cleanupTimer) {
    clearInterval(cleanupTimer)
    cleanupTimer = null
  }

  try {
    if (runtime) {
      runtime.logs.log({ source: 'system', level: 'info', message: 'Shutting down...' })
      await runtime.tunnels.shutdown()
      await runtime.applications.shutdown()
      // Push any buffered log lines before the window goes away.
      runtime.events.flushLogs()
      await runtime.logs.close()
      runtime.db.close()
    }
  } catch (error) {
    console.error('[shutdown]', error)
  } finally {
    forceKillAllTrackedProcesses()
    app.exit(0)
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(bootstrap).catch((error: unknown) => {
    const message = error instanceof AppError ? error.message : toErrorMessage(error)
    dialog.showErrorBox(
      'Local App Manager could not start',
      `${message}\n\nIf the problem persists, check that the application data folder is writable.`
    )
    app.exit(1)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) showMainWindow()
  })

  app.on('window-all-closed', () => {
    if (!runtime?.settings.get().minimizeToTray || !trayController) {
      app.quit()
    }
  })

  app.on('before-quit', (event) => {
    if (isQuitting) return
    event.preventDefault()
    void shutdown()
  })

  app.on('will-quit', () => {
    forceKillAllTrackedProcesses()
  })

  process.on('SIGINT', () => app.quit())
  process.on('SIGTERM', () => app.quit())

  process.on('uncaughtException', (error) => {
    console.error('[uncaughtException]', error)
    runtime?.logs.log({
      source: 'system',
      level: 'error',
      message: `Unhandled error: ${toErrorMessage(error)}`
    })
  })

  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason)
    runtime?.logs.log({
      source: 'system',
      level: 'error',
      message: `Unhandled promise rejection: ${toErrorMessage(reason)}`
    })
  })
}
