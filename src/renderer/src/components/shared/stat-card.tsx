import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default'
}: {
  label: string
  value: React.ReactNode
  hint?: string
  icon: LucideIcon
  tone?: 'default' | 'success' | 'primary' | 'muted'
}): React.JSX.Element {
  const toneClasses = {
    default: 'text-foreground',
    success: 'text-success',
    primary: 'text-primary',
    muted: 'text-muted-foreground'
  }[tone]

  return (
    <Card className="relative overflow-hidden p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={cn('text-2xl font-semibold tabular-nums tracking-tight', toneClasses)}>{value}</p>
          {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="rounded-lg border border-border bg-muted/40 p-2 text-muted-foreground">
          <Icon className="size-4" />
        </div>
      </div>
    </Card>
  )
}
