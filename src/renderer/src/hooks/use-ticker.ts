import { useEffect, useState } from 'react'

/** Re-renders periodically so relative timestamps and uptimes stay fresh, pausing while hidden. */
export function useTicker(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let timer: number | null = null

    const start = (): void => {
      if (timer !== null || document.hidden) return
      timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    }

    const stop = (): void => {
      if (timer === null) return
      window.clearInterval(timer)
      timer = null
    }

    const onVisibility = (): void => {
      if (document.hidden) {
        stop()
      } else {
        setNow(Date.now())
        start()
      }
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])

  return now
}
