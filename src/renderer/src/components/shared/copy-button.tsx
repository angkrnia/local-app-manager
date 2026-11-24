import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { copyToClipboard, cn } from '@/lib/utils'
import { Button, type ButtonProps } from '@/components/ui/button'

export function CopyButton({
  value,
  label = 'Copy',
  className,
  size = 'icon-sm',
  variant = 'ghost',
  toastOnCopy = true
}: {
  value: string
  label?: string
  className?: string
  size?: ButtonProps['size']
  variant?: ButtonProps['variant']
  toastOnCopy?: boolean
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)

  const handleCopy = async (): Promise<void> => {
    const success = await copyToClipboard(value)
    if (success) {
      setCopied(true)
      if (toastOnCopy) toast.success('Copied to clipboard')
      window.setTimeout(() => setCopied(false), 1_600)
    } else {
      toast.error('Could not copy to clipboard')
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn(className)}
      title={label}
      aria-label={label}
      onClick={() => void handleCopy()}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
    </Button>
  )
}
