import type { AppSettings, SettingsPatch } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/constants'
import { settingsPatchSchema, formatZodError } from '@shared/validation'
import { AppError, ErrorCode } from '@shared/errors'
import type { SettingsRepository } from '../database/repositories/settings'

type SettingsListener = (settings: AppSettings) => void

function decodeStoredValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export class SettingsService {
  private current: AppSettings
  private listeners = new Set<SettingsListener>()

  constructor(private readonly repository: SettingsRepository) {
    this.current = this.load()
  }

  private load(): AppSettings {
    const stored = this.repository.getAll()
    const candidate: Record<string, unknown> = {}
    for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>) {
      if (stored[key] !== undefined) {
        candidate[key] = decodeStoredValue(stored[key] as string)
      }
    }
    const parsed = settingsPatchSchema.safeParse(candidate)
    if (!parsed.success) {
      return { ...DEFAULT_SETTINGS }
    }
    return { ...DEFAULT_SETTINGS, ...parsed.data }
  }

  get(): AppSettings {
    return { ...this.current }
  }

  update(patch: SettingsPatch): AppSettings {
    const parsed = settingsPatchSchema.safeParse(patch)
    if (!parsed.success) {
      throw new AppError(ErrorCode.VALIDATION, formatZodError(parsed.error))
    }
    const changed = Object.entries(parsed.data).filter(([key, value]) => {
      const currentValue = this.current[key as keyof AppSettings]
      return currentValue !== value
    })
    if (changed.length === 0) return this.get()

    this.current = { ...this.current, ...parsed.data }
    this.repository.setMany(parsed.data as Record<string, unknown>)
    const snapshot = this.get()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch {
        // A listener must never break settings persistence.
      }
    }
    return snapshot
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
