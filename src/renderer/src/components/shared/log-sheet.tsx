import type { LogSource } from '@shared/types'
import { X } from 'lucide-react'
import { LogViewer } from './log-viewer'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogTitle,
  SheetContent
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export function LogSheet({
  open,
  onOpenChange,
  source,
  applicationId,
  tunnelId,
  title,
  subtitle
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: LogSource
  applicationId?: string | null
  tunnelId?: string | null
  title: string
  subtitle?: string
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent className="bg-background">
        <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <DialogTitle className="truncate text-sm">{title}</DialogTitle>
            <DialogDescription className="truncate text-xs">
              {subtitle ?? 'Live output streamed from the managed process.'}
            </DialogDescription>
          </div>
          <DialogClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close logs">
              <X />
            </Button>
          </DialogClose>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          <LogViewer
            source={source}
            applicationId={applicationId}
            tunnelId={tunnelId}
            title={title}
            subtitle={subtitle}
          />
        </div>
      </SheetContent>
    </Dialog>
  )
}
