import { create } from 'zustand'
import type {
  ActivityLog,
  AppSettings,
  Application,
  AppUpdateStatus,
  CloudflaredDownloadProgress,
  CloudflaredStatus,
  SystemInfo,
  Tunnel,
  WorkflowProgress
} from '@shared/types'
import { unwrap, errorMessage } from '../lib/api'

interface AppStore {
  applications: Application[]
  tunnels: Tunnel[]
  settings: AppSettings | null
  cloudflared: CloudflaredStatus | null
  activity: ActivityLog[]
  systemInfo: SystemInfo | null
  updater: AppUpdateStatus | null
  workflow: WorkflowProgress | null
  downloadProgress: CloudflaredDownloadProgress | null
  initialized: boolean
  initializing: boolean
  error: string | null

  initialize: () => Promise<void>
  refreshApplications: () => Promise<void>
  refreshTunnels: () => Promise<void>
  refreshActivity: (limit?: number) => Promise<void>
  refreshCloudflared: () => Promise<void>

  setApplications: (applications: Application[]) => void
  setTunnels: (tunnels: Tunnel[]) => void
  setSettings: (settings: AppSettings) => void
  setCloudflared: (status: CloudflaredStatus) => void
  setUpdater: (status: AppUpdateStatus) => void
  setActivity: (activity: ActivityLog[]) => void
  prependActivity: (entry: ActivityLog) => void
  setWorkflow: (progress: WorkflowProgress | null) => void
  setDownloadProgress: (progress: CloudflaredDownloadProgress | null) => void
}

export const useAppStore = create<AppStore>((set, get) => ({
  applications: [],
  tunnels: [],
  settings: null,
  cloudflared: null,
  activity: [],
  systemInfo: null,
  updater: null,
  workflow: null,
  downloadProgress: null,
  initialized: false,
  initializing: false,
  error: null,

  initialize: async () => {
    if (get().initializing || get().initialized) return
    set({ initializing: true, error: null })

    const results = await Promise.allSettled([
      unwrap(window.api.settings.get()),
      unwrap(window.api.applications.list()),
      unwrap(window.api.tunnels.list()),
      unwrap(window.api.activity.list({ limit: 200 })),
      unwrap(window.api.system.info()),
      unwrap(window.api.cloudflared.status()),
      unwrap(window.api.updater.status())
    ])

    const [settings, applications, tunnels, activity, systemInfo, cloudflared, updater] = results
    const failures = results.filter((result) => result.status === 'rejected') as PromiseRejectedResult[]

    set({
      settings: settings.status === 'fulfilled' ? settings.value : get().settings,
      applications: applications.status === 'fulfilled' ? applications.value : get().applications,
      tunnels: tunnels.status === 'fulfilled' ? tunnels.value : get().tunnels,
      activity: activity.status === 'fulfilled' ? activity.value : get().activity,
      systemInfo: systemInfo.status === 'fulfilled' ? systemInfo.value : get().systemInfo,
      cloudflared: cloudflared.status === 'fulfilled' ? cloudflared.value : get().cloudflared,
      updater: updater.status === 'fulfilled' ? updater.value : get().updater,
      initialized: true,
      initializing: false,
      error:
        failures.length > 0
          ? `Some data could not be loaded: ${errorMessage(failures[0]?.reason)}`
          : null
    })
  },

  refreshApplications: async () => {
    set({ applications: await unwrap(window.api.applications.list()) })
  },

  refreshTunnels: async () => {
    set({ tunnels: await unwrap(window.api.tunnels.list()) })
  },

  refreshActivity: async (limit = 200) => {
    set({ activity: await unwrap(window.api.activity.list({ limit })) })
  },

  refreshCloudflared: async () => {
    set({ cloudflared: await unwrap(window.api.cloudflared.status()) })
  },

  setApplications: (applications) => set({ applications }),
  setTunnels: (tunnels) => set({ tunnels }),
  setSettings: (settings) => set({ settings }),
  setCloudflared: (cloudflared) => set({ cloudflared }),
  setUpdater: (updater) => set({ updater }),
  setActivity: (activity) => set({ activity }),
  prependActivity: (entry) =>
    set((state) => {
      if (state.activity.some((item) => item.id === entry.id)) return state
      return { activity: [entry, ...state.activity].slice(0, 500) }
    }),
  setWorkflow: (workflow) => set({ workflow }),
  setDownloadProgress: (downloadProgress) => set({ downloadProgress })
}))
