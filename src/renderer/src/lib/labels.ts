import { APPLICATION_TYPE_OPTIONS } from '@shared/constants'
import type { ApplicationType } from '@shared/types'

export function applicationTypeLabel(type: ApplicationType): string {
  return APPLICATION_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? 'Custom'
}

export function applicationTypeOption(type: ApplicationType): (typeof APPLICATION_TYPE_OPTIONS)[number] {
  return (
    APPLICATION_TYPE_OPTIONS.find((option) => option.value === type) ??
    (APPLICATION_TYPE_OPTIONS[APPLICATION_TYPE_OPTIONS.length - 1] as (typeof APPLICATION_TYPE_OPTIONS)[number])
  )
}
