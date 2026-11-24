/**
 * Shared domain types used by the Electron main process, the preload bridge and
 * the React renderer. Keep this module free of Node.js and Electron imports.
 */

export type ApplicationType =
  | 'node'
  | 'nextjs'
  | 'nuxt'
  | 'vite'
  | 'react'
  | 'laravel'
  | 'php'
  | 'python'
  | 'docker'
  | 'custom'

export type ApplicationStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'
export type HealthStatus = 'unknown' | 'healthy' | 'unhealthy'
export type TunnelType = 'quick' | 'named'
export type TunnelStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogSource = 'application' | 'tunnel' | 'system'
export type LogStream = 'stdout' | 'stderr' | 'system'
export type ThemeMode = 'dark' | 'light' | 'system'
export type LocalProtocol = 'http' | 'https'

export interface Application {
  id: string
  name: string
  projectName: string
  description: string
  projectDirectory: string
  workingDirectory: string
  applicationType: ApplicationType
  startCommand: string
  stopCommand: string | null
  localHost: string
  localPort: number | null
  /** Sensitive values are returned masked; the mask marker means "keep existing value". */
  environmentVariables: Record<string, string>
  autoStart: boolean
  createdAt: string
  updatedAt: string
  /** Runtime-only fields, never persisted. */
  status: ApplicationStatus
  health: HealthStatus
  pid: number | null
  detectedPort: number | null
  startedAt: string | null
  lastError: string | null
  localUrl: string | null
}

export interface ApplicationInput {
  name: string
  projectName?: string
  description: string
  projectDirectory: string
  workingDirectory: string
  applicationType: ApplicationType
  startCommand: string
  stopCommand: string | null
  localHost: string
  localPort: number | null
  environmentVariables: Record<string, string>
  autoStart: boolean
}

export interface Tunnel {
  id: string
  applicationId: string | null
  applicationName: string | null
  tunnelType: TunnelType
  tunnelName: string | null
  hostname: string | null
  cloudflareTunnelId: string | null
  localUrl: string
  publicUrl: string | null
  status: TunnelStatus
  cloudflaredPid: number | null
  startedAt: string | null
  createdAt: string
  updatedAt: string
  lastError: string | null
}

export interface QuickTunnelInput {
  applicationId: string
  name?: string
  startNow?: boolean
}

export interface NamedTunnelInput {
  applicationId: string
  tunnelName: string
  hostname: string
  startNow?: boolean
}

export interface NamedTunnelRemote {
  id: string
  name: string
  createdAt: string | null
  connections: number | null
}

export interface NamedAuthStatus {
  authenticated: boolean
  certPath: string
  originCertExists: boolean
}

export interface PortCheckResult {
  host: string
  port: number
  inUse: boolean
  available: boolean
  processName: string | null
}

export interface ListeningPort {
  port: number
  localAddress: string
  pid: number
  processName: string
  isSystem: boolean
}

export interface KillPortResult {
  port: number
  pid: number
  processName: string
}

export interface CloudflaredStatus {
  available: boolean
  path: string | null
  version: string | null
  source: 'settings' | 'managed' | 'system' | null
  latestVersion: string | null
  updateAvailable: boolean
  managedPath: string
  lastCheckedAt: string | null
  lastError: string | null
  checking: boolean
  downloading: boolean
}

export interface CloudflaredDownloadProgress {
  receivedBytes: number
  totalBytes: number | null
  percent: number | null
}

export type AppUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface AppUpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export interface AppUpdateStatus {
  state: AppUpdateState
  currentVersion: string
  availableVersion: string | null
  releaseDate: string | null
  releaseUrl: string
  progress: AppUpdateProgress | null
  message: string | null
  lastCheckedAt: string | null
  canAutoInstall: boolean
}

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  source: LogSource
  applicationId: string | null
  tunnelId: string | null
  message: string
  stream: LogStream
}

export interface LogQuery {
  source?: LogSource
  applicationId?: string
  tunnelId?: string
  level?: LogLevel
  search?: string
  limit?: number
}

export interface ActivityLog {
  id: string
  applicationId: string | null
  tunnelId: string | null
  level: LogLevel
  message: string
  createdAt: string
  applicationName?: string | null
  tunnelName?: string | null
}

export interface ActivityQuery {
  applicationId?: string
  tunnelId?: string
  level?: LogLevel
  search?: string
  limit?: number
}

export interface AppSettings {
  launchOnStartup: boolean
  minimizeToTray: boolean
  destroyWindowOnHide: boolean
  launchMinimized: boolean
  theme: ThemeMode
  defaultWorkingDirectory: string
  defaultTunnelType: TunnelType
  cloudflaredPath: string
  defaultProtocol: LocalProtocol
  tunnelStartupTimeoutMs: number
  appStartupTimeoutMs: number
  healthCheckIntervalMs: number
  processTerminationTimeoutMs: number
  maxLogEntries: number
  logDirectory: string
  autoCleanupLogs: boolean
  logRetentionDays: number
  hasAcceptedPublicWarning: boolean
}

export type SettingsPatch = Partial<AppSettings>

export interface ProcessSession {
  id: string
  applicationId: string | null
  tunnelId: string | null
  processType: 'application' | 'tunnel'
  pid: number | null
  status: 'running' | 'stopped' | 'exited' | 'crashed' | 'orphaned'
  startedAt: string
  stoppedAt: string | null
  exitCode: number | null
}

export type WorkflowStep =
  | 'validate'
  | 'port-check'
  | 'start-application'
  | 'health-check'
  | 'start-tunnel'
  | 'detect-url'
  | 'complete'

export interface WorkflowProgress {
  applicationId: string
  tunnelId: string | null
  step: WorkflowStep
  status: 'running' | 'success' | 'error'
  message: string
  progress: number
}

export interface ToastPayload {
  type: 'success' | 'error' | 'info' | 'warning'
  title: string
  description?: string
}

export interface LogsClearedPayload {
  source: LogSource
  applicationId: string | null
  tunnelId: string | null
}

export interface BatchResult {
  succeeded: string[]
  failed: Array<{ id: string; error: string }>
}

export interface SystemInfo {
  appVersion: string
  electronVersion: string
  nodeVersion: string
  chromeVersion: string
  platform: string
  arch: string
  userDataPath: string
  databasePath: string
  logsPath: string
  isPackaged: boolean
}

export interface ApplicationResourceUsage {
  applicationId: string
  pid: number | null
  processCount: number
  memoryBytes: number
}

/** On-demand memory snapshot; never polled in the background. */
export interface ResourceSnapshot {
  capturedAt: string
  totalMemoryBytes: number
  freeMemoryBytes: number
  /** Tunnel Manager itself (main + renderer + gpu + utility). */
  selfMemoryBytes: number
  applications: ApplicationResourceUsage[]
}

export interface ApiError {
  code: string
  message: string
  details?: string
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

export interface NamedTunnelCreateRemoteInput {
  name: string
}

export interface RouteDnsInput {
  tunnelName: string
  hostname: string
}

export interface TunnelRemoveOptions {
  deleteRemote?: boolean
}

export interface ExportLogsInput {
  source: LogSource
  applicationId?: string
  tunnelId?: string
  suggestedName?: string
}

export interface TunnelManagerApi {
  applications: {
    list(): Promise<ApiResult<Application[]>>
    create(input: ApplicationInput): Promise<ApiResult<Application>>
    update(id: string, input: ApplicationInput): Promise<ApiResult<Application>>
    remove(id: string): Promise<ApiResult<void>>
    duplicate(id: string): Promise<ApiResult<Application>>
    reorder(ids: string[]): Promise<ApiResult<Application[]>>
    start(id: string): Promise<ApiResult<Application>>
    stop(id: string): Promise<ApiResult<Application>>
    restart(id: string): Promise<ApiResult<Application>>
    startAndExpose(id: string): Promise<ApiResult<{ application: Application; tunnel: Tunnel }>>
    stopEverything(id: string): Promise<ApiResult<Application>>
    openDirectory(id: string): Promise<ApiResult<void>>
    openLocalUrl(id: string): Promise<ApiResult<void>>
    checkPort(host: string, port: number): Promise<ApiResult<PortCheckResult>>
  }
  tunnels: {
    list(): Promise<ApiResult<Tunnel[]>>
    createQuick(input: QuickTunnelInput): Promise<ApiResult<Tunnel>>
    createNamed(input: NamedTunnelInput): Promise<ApiResult<Tunnel>>
    start(id: string, acknowledgePublicExposure?: boolean): Promise<ApiResult<Tunnel>>
    stop(id: string): Promise<ApiResult<Tunnel>>
    restart(id: string): Promise<ApiResult<Tunnel>>
    remove(id: string, options?: TunnelRemoveOptions): Promise<ApiResult<void>>
    startMany(ids: string[]): Promise<ApiResult<BatchResult>>
    stopMany(ids: string[]): Promise<ApiResult<BatchResult>>
    restartMany(ids: string[]): Promise<ApiResult<BatchResult>>
    startAll(): Promise<ApiResult<BatchResult>>
    stopAll(): Promise<ApiResult<BatchResult>>
    openPublicUrl(id: string): Promise<ApiResult<void>>
    acceptPublicExposure(): Promise<ApiResult<void>>
  }
  named: {
    status(): Promise<ApiResult<NamedAuthStatus>>
    login(): Promise<ApiResult<NamedAuthStatus>>
    listRemote(): Promise<ApiResult<NamedTunnelRemote[]>>
    createRemote(input: NamedTunnelCreateRemoteInput): Promise<ApiResult<NamedTunnelRemote>>
    routeDns(input: RouteDnsInput): Promise<ApiResult<void>>
  }
  cloudflared: {
    status(): Promise<ApiResult<CloudflaredStatus>>
    checkForUpdates(): Promise<ApiResult<CloudflaredStatus>>
    download(): Promise<ApiResult<CloudflaredStatus>>
    selectBinary(): Promise<ApiResult<CloudflaredStatus>>
    resetBinaryPath(): Promise<ApiResult<CloudflaredStatus>>
  }
  logs: {
    query(query: LogQuery): Promise<ApiResult<LogEntry[]>>
    clear(query: Pick<LogQuery, 'source' | 'applicationId' | 'tunnelId'>): Promise<ApiResult<void>>
    export(input: ExportLogsInput): Promise<ApiResult<{ saved: boolean; path: string | null }>>
  }
  activity: {
    list(query?: ActivityQuery): Promise<ApiResult<ActivityLog[]>>
    clear(): Promise<ApiResult<void>>
  }
  settings: {
    get(): Promise<ApiResult<AppSettings>>
    update(patch: SettingsPatch): Promise<ApiResult<AppSettings>>
  }
  system: {
    info(): Promise<ApiResult<SystemInfo>>
    openPath(path: string): Promise<ApiResult<void>>
    openExternal(url: string): Promise<ApiResult<void>>
    selectDirectory(defaultPath?: string): Promise<ApiResult<string | null>>
    selectFile(filters?: Array<{ name: string; extensions: string[] }>): Promise<ApiResult<string | null>>
    showItemInFolder(path: string): Promise<ApiResult<void>>
  }
  ports: {
    list(): Promise<ApiResult<ListeningPort[]>>
    check(port: number): Promise<ApiResult<ListeningPort | null>>
    kill(port: number): Promise<ApiResult<KillPortResult>>
  }
  updater: {
    status(): Promise<ApiResult<AppUpdateStatus>>
    check(): Promise<ApiResult<AppUpdateStatus>>
    download(): Promise<ApiResult<AppUpdateStatus>>
    install(): Promise<ApiResult<void>>
    openReleasePage(): Promise<ApiResult<void>>
  }
  events: {
    onApplicationsChanged(cb: (applications: Application[]) => void): () => void
    onTunnelsChanged(cb: (tunnels: Tunnel[]) => void): () => void
    onLogs(cb: (entries: LogEntry[]) => void): () => void
    onLogsCleared(cb: (payload: LogsClearedPayload) => void): () => void
    onActivity(cb: (activity: ActivityLog) => void): () => void
    onToast(cb: (toast: ToastPayload) => void): () => void
    onWorkflow(cb: (progress: WorkflowProgress) => void): () => void
    onCloudflaredStatus(cb: (status: CloudflaredStatus) => void): () => void
    onDownloadProgress(cb: (progress: CloudflaredDownloadProgress) => void): () => void
    onUpdaterStatus(cb: (status: AppUpdateStatus) => void): () => void
  }
}
