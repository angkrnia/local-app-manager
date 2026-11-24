import { NavLink } from 'react-router-dom'
import {
  Boxes,
  CloudCog,
  LayoutDashboard,
  Plug,
  RadioTower,
  ScrollText,
  Settings2,
  type LucideIcon
} from 'lucide-react'
import { APP_NAME } from '@shared/constants'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { Spinner } from '@/components/shared/spinner'

const NAV_ITEMS: Array<{ to: string; label: string; icon: LucideIcon; end?: boolean }> = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/applications', label: 'Applications', icon: Boxes },
  { to: '/tunnels', label: 'Tunnels', icon: RadioTower },
  { to: '/ports', label: 'Ports', icon: Plug },
  { to: '/activity', label: 'Activity', icon: ScrollText },
  { to: '/settings', label: 'Settings', icon: Settings2 }
]

function CloudflaredFooter(): React.JSX.Element {
  const status = useAppStore((state) => state.cloudflared)
  const available = status?.available ?? false

  return (
    <NavLink
      to="/settings"
      className="flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 transition-colors hover:border-border hover:bg-accent/60"
      title={status?.path ?? 'cloudflared is not installed'}
    >
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          available ? 'bg-success' : status ? 'bg-destructive' : 'bg-muted-foreground/50'
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[11px] font-medium text-foreground">
          {available ? 'cloudflared ready' : status ? 'cloudflared missing' : 'Checking cloudflared'}
        </span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {available && status?.version ? `v${status.version}` : status ? 'Open settings to install' : 'Please wait'}
        </span>
      </span>
      <CloudCog className="size-3.5 shrink-0 text-muted-foreground" />
    </NavLink>
  )
}

export function AppShell({ children }: { children: React.ReactNode }): React.JSX.Element {
  const initialized = useAppStore((state) => state.initialized)
  const initializing = useAppStore((state) => state.initializing)
  const error = useAppStore((state) => state.error)

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[212px] shrink-0 flex-col border-r border-border bg-card/60">
        <div className="flex h-14 items-center gap-2.5 border-b border-border/60 px-4">
          <span className="grid size-7 place-items-center rounded-md bg-primary/15 text-primary">
            <RadioTower className="size-3.5" aria-hidden="true" />
          </span>
          <p className="truncate text-sm font-semibold tracking-tight">{APP_NAME}</p>
        </div>

        <nav aria-label="Main navigation" className="flex-1 space-y-0.5 px-2.5 py-3">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon
                    aria-hidden="true"
                    className={cn('size-4', isActive ? 'text-primary' : 'text-muted-foreground')}
                  />
                  <span className="flex-1">{item.label}</span>
                  {item.to === '/applications' && <ApplicationCount />}
                  {item.to === '/tunnels' && <ActiveTunnelCount />}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-border p-2.5">
          <CloudflaredFooter />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="border-b border-destructive/25 bg-destructive/10 px-6 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1440px] px-6 py-6 lg:px-8">
            {!initialized ? (
              <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                <Spinner className="size-5" />
                <p>{initializing ? 'Loading your workspace…' : 'Preparing Local App Manager…'}</p>
              </div>
            ) : (
              children
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function ApplicationCount(): React.JSX.Element | null {
  const count = useAppStore((state) => state.applications.length)
  if (count === 0) return null
  return <span className="text-[10px] tabular-nums text-muted-foreground">{count}</span>
}

function ActiveTunnelCount(): React.JSX.Element | null {
  const count = useAppStore(
    (state) => state.tunnels.filter((tunnel) => tunnel.status === 'running').length
  )
  if (count === 0) return null
  return (
    <span className="rounded-full bg-success/15 px-1.5 text-[10px] font-semibold tabular-nums text-success">
      {count}
    </span>
  )
}
