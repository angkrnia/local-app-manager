import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { AlertTriangle, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { unwrap, errorMessage } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from './spinner'

interface ExposureContextValue {
  ensureAccepted: () => Promise<boolean>
}

const ExposureContext = createContext<ExposureContextValue | null>(null)

export function useExposure(): ExposureContextValue {
  const context = useContext(ExposureContext)
  if (!context) throw new Error('useExposure must be used inside ExposureProvider')
  return context
}

export function ExposureProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const resolverRef = useRef<((accepted: boolean) => void) | null>(null)

  const ensureAccepted = useCallback((): Promise<boolean> => {
    if (useAppStore.getState().settings?.hasAcceptedPublicWarning) return Promise.resolve(true)
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve
      setOpen(true)
    })
  }, [])

  const finish = (accepted: boolean): void => {
    resolverRef.current?.(accepted)
    resolverRef.current = null
    setOpen(false)
  }

  const accept = async (): Promise<void> => {
    setBusy(true)
    try {
      await unwrap(window.api.tunnels.acceptPublicExposure())
      const settings = useAppStore.getState().settings
      if (settings) useAppStore.getState().setSettings({ ...settings, hasAcceptedPublicWarning: true })
      finish(true)
    } catch (error) {
      toast.error('Could not save your confirmation', { description: errorMessage(error) })
      finish(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <ExposureContext.Provider value={{ ensureAccepted }}>
      {children}
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !busy) finish(false)
        }}
      >
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-warning/30 bg-warning/10 p-1.5 text-warning">
                <ShieldAlert className="size-4" />
              </span>
              <AlertDialogTitle>Expose an application to the internet?</AlertDialogTitle>
            </div>
            <AlertDialogDescription>
              A Cloudflare Quick Tunnel creates a public URL that forwards traffic to an application on this
              computer. Read this before continuing.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3 rounded-lg border border-warning/25 bg-warning/[0.06] p-4 text-xs text-foreground/90">
            <div className="flex gap-2">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
              <p>Anyone who knows the URL can access your local application. There is no authentication added by Local App Manager.</p>
            </div>
            <ul className="ml-5 list-disc space-y-1 text-muted-foreground">
              <li>Quick Tunnel URLs are temporary and have no uptime guarantee.</li>
              <li>Do not expose production secrets, admin panels, databases, or personal data.</li>
              <li>Stop the tunnel when you are finished working.</li>
            </ul>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button variant="default" disabled={busy} onClick={() => void accept()}>
              {busy && <Spinner />}
              I understand, expose it
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ExposureContext.Provider>
  )
}
