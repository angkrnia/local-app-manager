import type { AppSettings, ApplicationType } from './types'

export const APP_NAME = 'Local App Manager'
export const APP_ID = 'com.localappmanager.desktop'
export const APP_VERSION_FALLBACK = '1.0.0'

export const GITHUB_REPO = {
  owner: 'angkrnia',
  repo: 'local-app-manager',
  url: 'https://github.com/angkrnia/local-app-manager',
  releasesUrl: 'https://github.com/angkrnia/local-app-manager/releases',
  releasesApi: 'https://api.github.com/repos/angkrnia/local-app-manager/releases/latest'
} as const

/** Marker returned to the renderer instead of sensitive environment variable values. */
export const MASKED_SECRET = '••••••••'

/** Environment variable names matching this pattern are never sent to the renderer in plaintext. */
export const SENSITIVE_ENV_KEY_PATTERN =
  /(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|credential|auth|salt|cert|key)$/i

export const PUBLIC_EXPOSURE_WARNING =
  'Quick Tunnels make your local application reachable from the public internet. Anyone with the URL can access it. ' +
  'Only expose applications you trust, never expose services containing unsecured personal data, and stop the tunnel when you are done.'

export const APPLICATION_TYPE_OPTIONS: Array<{
  value: ApplicationType
  label: string
  description: string
  defaultCommand: string
  defaultPort: number
}> = [
  {
    value: 'node',
    label: 'Node.js',
    description: 'Generic Node.js server or script',
    defaultCommand: 'npm run dev',
    defaultPort: 3000
  },
  {
    value: 'nextjs',
    label: 'Next.js',
    description: 'Next.js development server',
    defaultCommand: 'npm run dev',
    defaultPort: 3000
  },
  {
    value: 'nuxt',
    label: 'Nuxt',
    description: 'Nuxt development server',
    defaultCommand: 'npm run dev',
    defaultPort: 3000
  },
  {
    value: 'vite',
    label: 'Vite',
    description: 'Vite / React / Vue development server',
    defaultCommand: 'npm run dev',
    defaultPort: 5173
  },
  {
    value: 'react',
    label: 'React (CRA)',
    description: 'Create React App development server',
    defaultCommand: 'npm start',
    defaultPort: 3000
  },
  {
    value: 'laravel',
    label: 'Laravel',
    description: 'Laravel artisan development server',
    defaultCommand: 'php artisan serve --host=127.0.0.1 --port=8000',
    defaultPort: 8000
  },
  {
    value: 'php',
    label: 'PHP',
    description: 'PHP built-in web server',
    defaultCommand: 'php -S 127.0.0.1:8000',
    defaultPort: 8000
  },
  {
    value: 'python',
    label: 'Python',
    description: 'Uvicorn / FastAPI / Flask server',
    defaultCommand: 'python -m uvicorn main:app --reload --port 8000',
    defaultPort: 8000
  },
  {
    value: 'docker',
    label: 'Docker',
    description: 'Docker Compose stack',
    defaultCommand: 'docker compose up',
    defaultPort: 8080
  },
  {
    value: 'custom',
    label: 'Custom',
    description: 'Any command that serves HTTP on a port',
    defaultCommand: '',
    defaultPort: 3000
  }
]

export const DEFAULT_SETTINGS: AppSettings = {
  launchOnStartup: false,
  minimizeToTray: true,
  destroyWindowOnHide: true,
  launchMinimized: false,
  theme: 'dark',
  defaultWorkingDirectory: '',
  defaultTunnelType: 'quick',
  cloudflaredPath: '',
  defaultProtocol: 'http',
  tunnelStartupTimeoutMs: 90_000,
  appStartupTimeoutMs: 90_000,
  healthCheckIntervalMs: 15_000,
  processTerminationTimeoutMs: 8_000,
  maxLogEntries: 2_000,
  logDirectory: '',
  autoCleanupLogs: true,
  logRetentionDays: 14,
  hasAcceptedPublicWarning: false
}

export const LIMITS = {
  applicationName: 80,
  description: 500,
  command: 2_000,
  path: 1_000,
  environmentVariables: 64,
  environmentValue: 8_000,
  tunnelName: 63,
  hostname: 253,
  logMessage: 16_000,
  maxLogsPerQuery: 5_000,
  maxBatchSize: 100
} as const

export const TRYCLOUDFLARE_SUFFIX = '.trycloudflare.com'

export const CLOUDFLARED_RELEASES_API =
  'https://api.github.com/repos/cloudflare/cloudflared/releases/latest'

export const CLOUDFLARED_DOWNLOAD_URLS: Record<string, string> = {
  x64: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
  ia32: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-386.exe',
  arm64:
    'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe'
}

export const CLOUDFLARED_MIN_BINARY_BYTES = 5 * 1024 * 1024

export const CLOUDFLARED_COMMON_PATHS = [
  'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
  'C:\\Program Files\\cloudflared\\cloudflared.exe',
  'C:\\cloudflared\\cloudflared.exe'
]

export const IPC = {
  applications: {
    list: 'applications:list',
    create: 'applications:create',
    update: 'applications:update',
    remove: 'applications:remove',
    duplicate: 'applications:duplicate',
    reorder: 'applications:reorder',
    start: 'applications:start',
    stop: 'applications:stop',
    restart: 'applications:restart',
    startAndExpose: 'applications:start-and-expose',
    stopEverything: 'applications:stop-everything',
    openDirectory: 'applications:open-directory',
    openLocalUrl: 'applications:open-local-url',
    checkPort: 'applications:check-port'
  },
  tunnels: {
    list: 'tunnels:list',
    createQuick: 'tunnels:create-quick',
    createNamed: 'tunnels:create-named',
    start: 'tunnels:start',
    stop: 'tunnels:stop',
    restart: 'tunnels:restart',
    remove: 'tunnels:remove',
    startMany: 'tunnels:start-many',
    stopMany: 'tunnels:stop-many',
    restartMany: 'tunnels:restart-many',
    startAll: 'tunnels:start-all',
    stopAll: 'tunnels:stop-all',
    openPublicUrl: 'tunnels:open-public-url',
    acceptPublicExposure: 'tunnels:accept-public-exposure'
  },
  named: {
    status: 'named:status',
    login: 'named:login',
    listRemote: 'named:list-remote',
    createRemote: 'named:create-remote',
    routeDns: 'named:route-dns'
  },
  cloudflared: {
    status: 'cloudflared:status',
    checkForUpdates: 'cloudflared:check-for-updates',
    download: 'cloudflared:download',
    selectBinary: 'cloudflared:select-binary',
    resetBinaryPath: 'cloudflared:reset-binary-path'
  },
  logs: {
    query: 'logs:query',
    clear: 'logs:clear',
    export: 'logs:export'
  },
  activity: {
    list: 'activity:list',
    clear: 'activity:clear'
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update'
  },
  system: {
    info: 'system:info',
    openPath: 'system:open-path',
    openExternal: 'system:open-external',
    selectDirectory: 'system:select-directory',
    selectFile: 'system:select-file',
    showItemInFolder: 'system:show-item-in-folder',
    resources: 'system:resources'
  },
  ports: {
    list: 'ports:list',
    check: 'ports:check',
    kill: 'ports:kill'
  },
  updater: {
    status: 'updater:status',
    check: 'updater:check',
    download: 'updater:download',
    install: 'updater:install',
    openReleasePage: 'updater:open-release-page'
  },
  events: {
    applicationsChanged: 'events:applications-changed',
    tunnelsChanged: 'events:tunnels-changed',
    /** Batched log delivery: payload is LogEntry[] to keep IPC traffic low. */
    logs: 'events:logs',
    logsCleared: 'events:logs-cleared',
    activity: 'events:activity',
    toast: 'events:toast',
    workflow: 'events:workflow',
    cloudflaredStatus: 'events:cloudflared-status',
    downloadProgress: 'events:download-progress',
    updaterStatus: 'events:updater-status'
  }
} as const
