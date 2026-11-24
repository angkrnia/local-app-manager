import { Check, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app-store'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

const STEPS: Array<{ key: string; label: string }> = [
  { key: 'validate', label: 'Validate' },
  { key: 'port-check', label: 'Port' },
  { key: 'start-application', label: 'Start app' },
  { key: 'health-check', label: 'Health' },
  { key: 'start-tunnel', label: 'Tunnel' },
  { key: 'detect-url', label: 'Public URL' },
  { key: 'complete', label: 'Ready' }
]

export function WorkflowProgressPanel(): React.JSX.Element | null {
  const workflow = useAppStore((state) => state.workflow)
  const setWorkflow = useAppStore((state) => state.setWorkflow)
  if (!workflow) return null

  const currentIndex = STEPS.findIndex((step) => step.key === workflow.step)
  const failed = workflow.status === 'error'
  const complete = workflow.status === 'success'

  return (
    <Card
      className={cn(
        'overflow-hidden border-l-2 p-4',
        failed ? 'border-l-destructive' : complete ? 'border-l-success' : 'border-l-primary'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Start &amp; Expose
          </p>
          <p className={cn('mt-0.5 text-sm', failed ? 'text-destructive' : 'text-foreground')}>
            {workflow.message}
          </p>
        </div>
        {!workflow.status || workflow.status !== 'running' ? (
          <Button variant="ghost" size="icon-xs" onClick={() => setWorkflow(null)} title="Dismiss">
            <X />
          </Button>
        ) : (
          <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
        )}
      </div>

      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            failed ? 'bg-destructive' : complete ? 'bg-success' : 'bg-primary'
          )}
          style={{ width: `${Math.max(failed ? 100 : 4, workflow.progress)}%` }}
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {STEPS.map((step, index) => {
          const done = complete || index < currentIndex
          const active = !complete && !failed && index === currentIndex
          return (
            <span
              key={step.key}
              className={cn(
                'flex items-center gap-1 text-[11px]',
                done ? 'text-success' : active ? 'text-primary' : 'text-muted-foreground/60'
              )}
            >
              {done ? (
                <Check className="size-3" />
              ) : active ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <span className="size-1.5 rounded-full bg-current opacity-50" />
              )}
              {step.label}
            </span>
          )
        })}
      </div>
    </Card>
  )
}
