export const ErrorCode = {
  VALIDATION: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INVALID_STATE: 'INVALID_STATE',
  PORT_IN_USE: 'PORT_IN_USE',
  DIRECTORY_NOT_FOUND: 'DIRECTORY_NOT_FOUND',
  PROCESS_START_FAILED: 'PROCESS_START_FAILED',
  HEALTH_CHECK_TIMEOUT: 'HEALTH_CHECK_TIMEOUT',
  HEALTH_CHECK_FAILED: 'HEALTH_CHECK_FAILED',
  CLOUDFLARED_NOT_FOUND: 'CLOUDFLARED_NOT_FOUND',
  CLOUDFLARED_FAILED: 'CLOUDFLARED_FAILED',
  CLOUDFLARED_DOWNLOAD_FAILED: 'CLOUDFLARED_DOWNLOAD_FAILED',
  TUNNEL_URL_TIMEOUT: 'TUNNEL_URL_TIMEOUT',
  TUNNEL_START_FAILED: 'TUNNEL_START_FAILED',
  TUNNEL_NOT_READY: 'TUNNEL_NOT_READY',
  PUBLIC_EXPOSURE_NOT_ACKNOWLEDGED: 'PUBLIC_EXPOSURE_NOT_ACKNOWLEDGED',
  CLOUDFLARE_NOT_AUTHENTICATED: 'CLOUDFLARE_NOT_AUTHENTICATED',
  CLOUDFLARE_AUTH_FAILED: 'CLOUDFLARE_AUTH_FAILED',
  CLOUDFLARE_COMMAND_FAILED: 'CLOUDFLARE_COMMAND_FAILED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  UNSUPPORTED_PLATFORM: 'UNSUPPORTED_PLATFORM',
  INTERNAL: 'INTERNAL_ERROR'
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

export class AppError extends Error {
  readonly code: ErrorCodeValue | string
  readonly details?: string

  constructor(code: ErrorCodeValue | string, message: string, details?: string) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'An unknown error occurred'
}
