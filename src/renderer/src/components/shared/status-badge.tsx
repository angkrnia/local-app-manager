import type { ApplicationStatus, HealthStatus, TunnelStatus } from '@shared/types'
import { cn } from '@/lib/utils'

const STATUS_CONFIG: Record<
  ApplicationStatus | TunnelStatus,
  { label: string; className: string; dotClassName: string; pulse?: boolean }
> = {
  stopped: {
    label: 'Stopped',
    className: 'text-muted-foreground',
    dotClassName: 'bg-muted-foreground/50'
  },
  starting: {
    label: 'Starting',
    className: 'text-warning',
    dotClassName: 'bg-warning',
    pulse: true
  },
  running: {
    label: 'Running',
    className: 'text-success',
    dotClassName: 'bg-success'
  },
  stopping: {
    label: 'Stopping',
    className: 'text-warning',
    dotClassName: 'bg-warning',
    pulse: true
  },
  error: {
    label: 'Error',
    className: 'text-destructive',
    dotClassName: 'bg-destructive'
  }
}

export function StatusBadge({
  status,
  health,
  className
}: {
  status: ApplicationStatus | TunnelStatus
  health?: HealthStatus
  className?: string
}): React.JSX.Element {
  const config = STATUS_CONFIG[status]
  const unhealthy = health === 'unhealthy'
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-2 whitespace-nowrap text-xs font-medium',
        config.className,
        className
      )}
      title={unhealthy ? 'Health check is failing' : undefined}
    >
      <span className="relative flex size-2 shrink-0">
        {config.pulse && (
          <span
            className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', config.dotClassName)}
          />
        )}
        <span className={cn('relative inline-flex size-2 rounded-full', config.dotClassName)} />
      </span>
      <span>{config.label}</span>
      {unhealthy && <span className="text-[11px] text-warning">· unhealthy</span>}
    </span>
  )
}
