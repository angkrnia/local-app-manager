import { toast } from 'sonner'
import type { ApiResult } from '@shared/types'
import { errorMessage, unwrap } from './api'

interface RunOptions<T> {
  loading?: string
  success?: string | ((data: T) => string)
  error?: string
}

/**
 * Runs an IPC action with consistent loading/success/error toasts.
 * Returns the unwrapped data, or null when the action failed.
 */
export async function run<T>(
  action: () => Promise<ApiResult<T>>,
  options: RunOptions<T> = {}
): Promise<T | null> {
  const toastId = options.loading ? toast.loading(options.loading) : undefined
  try {
    const data = await unwrap(action())
    const message = typeof options.success === 'function' ? options.success(data) : options.success
    if (message) {
      toast.success(message, toastId ? { id: toastId } : undefined)
    } else if (toastId) {
      toast.dismiss(toastId)
    }
    return data
  } catch (error) {
    const description = errorMessage(error)
    const title = options.error ?? 'Action failed'
    if (toastId) toast.error(title, { id: toastId, description, duration: 8_000 })
    else toast.error(title, { description, duration: 8_000 })
    return null
  }
}

/**
 * Runs a void/null-returning IPC action with toasts and returns true on success.
 * Use this instead of checking `run(...) !== null`, since void IPC handlers return null.
 */
export async function runAction(
  action: () => Promise<ApiResult<unknown>>,
  options: RunOptions<unknown> = {}
): Promise<boolean> {
  const toastId = options.loading ? toast.loading(options.loading) : undefined
  try {
    const data = await unwrap(action())
    const message = typeof options.success === 'function' ? options.success(data) : options.success
    if (message) {
      toast.success(message, toastId ? { id: toastId } : undefined)
    } else if (toastId) {
      toast.dismiss(toastId)
    }
    return true
  } catch (error) {
    const description = errorMessage(error)
    const title = options.error ?? 'Action failed'
    if (toastId) toast.error(title, { id: toastId, description, duration: 8_000 })
    else toast.error(title, { description, duration: 8_000 })
    return false
  }
}
