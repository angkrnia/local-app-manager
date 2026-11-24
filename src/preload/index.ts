import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/constants'
import type {
  ActivityLog,
  ApiResult,
  Application,
  AppUpdateStatus,
  CloudflaredDownloadProgress,
  CloudflaredStatus,
  KillPortResult,
  ListeningPort,
  LogEntry,
  LogsClearedPayload,
  ToastPayload,
  Tunnel,
  TunnelManagerApi,
  WorkflowProgress
} from '@shared/types'

function invoke<T>(channel: string, ...args: unknown[]): Promise<ApiResult<T>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<ApiResult<T>>
}

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: TunnelManagerApi = {
  applications: {
    list: () => invoke<Application[]>(IPC.applications.list),
    create: (input) => invoke<Application>(IPC.applications.create, input),
    update: (id, input) => invoke<Application>(IPC.applications.update, id, input),
    remove: (id) => invoke<void>(IPC.applications.remove, id),
    duplicate: (id) => invoke<Application>(IPC.applications.duplicate, id),
    reorder: (ids) => invoke<Application[]>(IPC.applications.reorder, ids),
    start: (id) => invoke<Application>(IPC.applications.start, id),
    stop: (id) => invoke<Application>(IPC.applications.stop, id),
    restart: (id) => invoke<Application>(IPC.applications.restart, id),
    startAndExpose: (id) => invoke(IPC.applications.startAndExpose, id),
    stopEverything: (id) => invoke<Application>(IPC.applications.stopEverything, id),
    openDirectory: (id) => invoke<void>(IPC.applications.openDirectory, id),
    openLocalUrl: (id) => invoke<void>(IPC.applications.openLocalUrl, id),
    checkPort: (host, port) => invoke(IPC.applications.checkPort, host, port)
  },
  tunnels: {
    list: () => invoke<Tunnel[]>(IPC.tunnels.list),
    createQuick: (input) => invoke<Tunnel>(IPC.tunnels.createQuick, input),
    createNamed: (input) => invoke<Tunnel>(IPC.tunnels.createNamed, input),
    start: (id, acknowledgePublicExposure) =>
      invoke<Tunnel>(IPC.tunnels.start, id, acknowledgePublicExposure),
    stop: (id) => invoke<Tunnel>(IPC.tunnels.stop, id),
    restart: (id) => invoke<Tunnel>(IPC.tunnels.restart, id),
    remove: (id, options) => invoke<void>(IPC.tunnels.remove, id, options),
    startMany: (ids) => invoke(IPC.tunnels.startMany, ids),
    stopMany: (ids) => invoke(IPC.tunnels.stopMany, ids),
    restartMany: (ids) => invoke(IPC.tunnels.restartMany, ids),
    startAll: () => invoke(IPC.tunnels.startAll),
    stopAll: () => invoke(IPC.tunnels.stopAll),
    openPublicUrl: (id) => invoke<void>(IPC.tunnels.openPublicUrl, id),
    acceptPublicExposure: () => invoke<void>(IPC.tunnels.acceptPublicExposure)
  },
  named: {
    status: () => invoke(IPC.named.status),
    login: () => invoke(IPC.named.login),
    listRemote: () => invoke(IPC.named.listRemote),
    createRemote: (input) => invoke(IPC.named.createRemote, input),
    routeDns: (input) => invoke(IPC.named.routeDns, input)
  },
  cloudflared: {
    status: () => invoke<CloudflaredStatus>(IPC.cloudflared.status),
    checkForUpdates: () => invoke<CloudflaredStatus>(IPC.cloudflared.checkForUpdates),
    download: () => invoke<CloudflaredStatus>(IPC.cloudflared.download),
    selectBinary: () => invoke<CloudflaredStatus>(IPC.cloudflared.selectBinary),
    resetBinaryPath: () => invoke<CloudflaredStatus>(IPC.cloudflared.resetBinaryPath)
  },
  logs: {
    query: (query) => invoke<LogEntry[]>(IPC.logs.query, query),
    clear: (query) => invoke<void>(IPC.logs.clear, query),
    export: (input) => invoke(IPC.logs.export, input)
  },
  activity: {
    list: (query) => invoke<ActivityLog[]>(IPC.activity.list, query),
    clear: () => invoke<void>(IPC.activity.clear)
  },
  settings: {
    get: () => invoke(IPC.settings.get),
    update: (patch) => invoke(IPC.settings.update, patch)
  },
  system: {
    info: () => invoke(IPC.system.info),
    openPath: (path) => invoke<void>(IPC.system.openPath, path),
    openExternal: (url) => invoke<void>(IPC.system.openExternal, url),
    selectDirectory: (defaultPath) => invoke<string | null>(IPC.system.selectDirectory, defaultPath),
    selectFile: (filters) => invoke<string | null>(IPC.system.selectFile, filters),
    showItemInFolder: (path) => invoke<void>(IPC.system.showItemInFolder, path)
  },
  ports: {
    list: () => invoke<ListeningPort[]>(IPC.ports.list),
    check: (port) => invoke<ListeningPort | null>(IPC.ports.check, port),
    kill: (port) => invoke<KillPortResult>(IPC.ports.kill, port)
  },
  updater: {
    status: () => invoke<AppUpdateStatus>(IPC.updater.status),
    check: () => invoke<AppUpdateStatus>(IPC.updater.check),
    download: () => invoke<AppUpdateStatus>(IPC.updater.download),
    install: () => invoke<void>(IPC.updater.install),
    openReleasePage: () => invoke<void>(IPC.updater.openReleasePage)
  },
  events: {
    onApplicationsChanged: (callback) =>
      subscribe<Application[]>(IPC.events.applicationsChanged, callback),
    onTunnelsChanged: (callback) => subscribe<Tunnel[]>(IPC.events.tunnelsChanged, callback),
    onLogs: (callback) => subscribe<LogEntry[]>(IPC.events.logs, callback),
    onLogsCleared: (callback) =>
      subscribe<LogsClearedPayload>(IPC.events.logsCleared, callback),
    onActivity: (callback) => subscribe<ActivityLog>(IPC.events.activity, callback),
    onToast: (callback) => subscribe<ToastPayload>(IPC.events.toast, callback),
    onWorkflow: (callback) => subscribe<WorkflowProgress>(IPC.events.workflow, callback),
    onCloudflaredStatus: (callback) =>
      subscribe<CloudflaredStatus>(IPC.events.cloudflaredStatus, callback),
    onDownloadProgress: (callback) =>
      subscribe<CloudflaredDownloadProgress>(IPC.events.downloadProgress, callback),
    onUpdaterStatus: (callback) =>
      subscribe<AppUpdateStatus>(IPC.events.updaterStatus, callback)
  }
}

contextBridge.exposeInMainWorld('api', api)
