import { useState } from 'react'
import { AlertTriangle, Download, Settings2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { unwrap, errorMessage } from '@/lib/api'
import { useAppStore } from '@/stores/app-store'
import { Button } from '@/components/ui/button'
import { Spinner } from './spinner'

export function CloudflaredBanner(): React.JSX.Element | null {
  const status = useAppStore((state) => state.cloudflared)
  const setCloudflared = useAppStore((state) => state.setCloudflared)
  const progress = useAppStore((state) => state.downloadProgress)
  const [downloading, setDownloading] = useState(false)
  const navigate = useNavigate()

  if (!status || status.available) return null

  const handleDownload = async (): Promise<void> => {
    setDownloading(true)
    try {
      const next = await unwrap(window.api.cloudflared.download())
      setCloudflared(next)
      toast.success('cloudflared installed', { description: next.version ? `Version ${next.version}` : undefined })
    } catch (error) {
      toast.error('Could not install cloudflared', { description: errorMessage(error), duration: 8_000 })
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="rounded-md border border-warning/30 bg-warning/10 p-1.5 text-warning">
          <AlertTriangle className="size-4" />
        </span>
        <div className="space-y-0.5">
          <p className="text-sm font-medium">cloudflared is not installed</p>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Local App Manager needs the official Cloudflare binary to create tunnels. Download it from Cloudflare&apos;s
            official GitHub release, or select an existing cloudflared.exe in Settings.
          </p>
          {progress?.percent !== null && progress?.percent !== undefined && downloading && (
            <p className="text-xs text-muted-foreground">Downloading… {progress.percent}%</p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate('/settings')}>
          <Settings2 />
          Settings
        </Button>
        <Button size="sm" disabled={downloading} onClick={() => void handleDownload()}>
          {downloading ? <Spinner /> : <Download />}
          {downloading ? 'Downloading…' : 'Download cloudflared'}
        </Button>
      </div>
    </div>
  )
}
