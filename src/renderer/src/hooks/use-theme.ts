import { useEffect, useState } from 'react'
import type { ThemeMode } from '@shared/types'
import { useAppStore } from '@/stores/app-store'

function resolve(mode: ThemeMode): 'dark' | 'light' {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Applies the persisted theme and returns the resolved light/dark value. */
export function useTheme(): 'dark' | 'light' {
  const mode = useAppStore((state) => state.settings?.theme ?? 'dark')
  const [resolved, setResolved] = useState<'dark' | 'light'>(() => resolve(mode))

  useEffect(() => {
    const apply = (): void => {
      const next = resolve(mode)
      setResolved(next)
      document.documentElement.classList.toggle('dark', next === 'dark')
      document.documentElement.style.colorScheme = next
    }

    apply()
    if (mode !== 'system') return

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [mode])

  return resolved
}
