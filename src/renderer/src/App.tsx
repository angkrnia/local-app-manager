import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useAppStore } from '@/stores/app-store'
import { useAppEvents } from '@/hooks/use-app-events'
import { useTheme } from '@/hooks/use-theme'
import { AppShell } from '@/components/layout/app-shell'
import { ExposureProvider } from '@/components/shared/exposure-provider'
import { TooltipProvider } from '@/components/ui/tooltip'
import DashboardPage from '@/pages/dashboard'
import ApplicationsPage from '@/pages/applications'
import TunnelsPage from '@/pages/tunnels'
import PortsPage from '@/pages/ports'
import ActivityPage from '@/pages/activity'
import SettingsPage from '@/pages/settings'

export default function App(): React.JSX.Element {
  const initialize = useAppStore((state) => state.initialize)
  const theme = useTheme()

  useAppEvents()

  useEffect(() => {
    void initialize()
  }, [initialize])

  return (
    <HashRouter>
      <TooltipProvider delayDuration={250}>
        <ExposureProvider>
          <AppShell>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/applications" element={<ApplicationsPage />} />
              <Route path="/tunnels" element={<TunnelsPage />} />
              <Route path="/ports" element={<PortsPage />} />
              <Route path="/activity" element={<ActivityPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppShell>
          <Toaster
            theme={theme}
            position="bottom-right"
            richColors
            closeButton
            toastOptions={{
              className: 'text-xs'
            }}
          />
        </ExposureProvider>
      </TooltipProvider>
    </HashRouter>
  )
}
