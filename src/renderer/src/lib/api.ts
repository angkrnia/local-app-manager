import type { ApiResult } from '@shared/types'

export class ApiClientError extends Error {
  readonly code: string
  readonly details?: string

  constructor(error: { code: string; message: string; details?: string }) {
    super(error.message)
    this.name = 'ApiClientError'
    this.code = error.code
    this.details = error.details
  }
}

export async function unwrap<T>(promise: Promise<ApiResult<T>>): Promise<T> {
  const result = await promise
  if (!result.ok) throw new ApiClientError(result.error)
  return result.data
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Something went wrong. Please try again.'
}

export function isPublicWarningError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'PUBLIC_EXPOSURE_NOT_ACKNOWLEDGED'
}

export function isCloudflaredMissingError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'CLOUDFLARED_NOT_FOUND'
}
