import { useEffect } from 'react'
import { toast } from 'sonner'
import type { ToastPayload } from '@shared/types'
import { useAppStore } from '@/stores/app-store'

function showToast(payload: ToastPayload): void {
  const options = { description: payload.description, duration: payload.type === 'error' ? 8_000 : 4_500 }
  switch (payload.type) {
    case 'success':
      toast.success(payload.title, options)
      break
    case 'error':
      toast.error(payload.title, options)
      break
    case 'warning':
      toast.warning(payload.title, options)
      break
    default:
      toast.info(payload.title, options)
  }
}

/** Connects main-process push events to the Zustand store. Mount once in App. */
export function useAppEvents(): void {
  useEffect(() => {
    const store = () => useAppStore.getState()

    const unsubscribers = [
      window.api.events.onApplicationsChanged((applications) => store().setApplications(applications)),
      window.api.events.onTunnelsChanged((tunnels) => store().setTunnels(tunnels)),
      window.api.events.onActivity((entry) => store().prependActivity(entry)),
      window.api.events.onToast(showToast),
      window.api.events.onWorkflow((progress) => store().setWorkflow(progress)),
      window.api.events.onCloudflaredStatus((status) => {
        store().setCloudflared(status)
        if (!status.downloading) store().setDownloadProgress(null)
      }),
      window.api.events.onDownloadProgress((progress) => store().setDownloadProgress(progress)),
      window.api.events.onUpdaterStatus((status) => store().setUpdater(status))
    ]

    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }, [])
}
