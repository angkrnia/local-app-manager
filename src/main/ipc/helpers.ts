import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { app } from 'electron'
import { ZodError } from 'zod'
import type { ApiResult } from '@shared/types'
import { AppError, ErrorCode, toErrorMessage } from '@shared/errors'
import { formatZodError } from '@shared/validation'
import type { ApplicationManager } from '../services/application-manager'
import type { TunnelManager } from '../services/tunnel-manager'
import type { WorkflowService } from '../services/workflow'
import type { CloudflaredManager } from '../services/cloudflared-manager'
import type { AppUpdaterService } from '../services/updater'
import type { SettingsService } from '../services/settings'
import type { LogManager } from '../services/log-manager'
import type { ActivityRepository } from '../services/database/repositories/activity-logs'
import type { EventBus } from '../services/event-bus'
import type { AppPaths } from '../utils/paths'

export interface IpcContext {
  applications: ApplicationManager
  tunnels: TunnelManager
  workflow: WorkflowService
  cloudflared: CloudflaredManager
  updater: AppUpdaterService
  settings: SettingsService
  logs: LogManager
  activity: ActivityRepository
  events: EventBus
  paths: AppPaths
  getMainWindow: () => BrowserWindow | null
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const senderUrl = event.senderFrame?.url || event.sender.getURL()
  if (!senderUrl) return false
  if (senderUrl.startsWith('file://')) return true
  if (app.isPackaged) return false
  try {
    const url = new URL(senderUrl)
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1')
    )
  } catch {
    return false
  }
}

/**
 * Registers a validated IPC handler that always resolves to an ApiResult
 * envelope, so renderer code never receives raw Node.js errors.
 */
export function handle(
  channel: string,
  handler: (...args: never[]) => unknown
): void {
  ipcMain.handle(channel, async (event, ...args): Promise<ApiResult<unknown>> => {
    if (!isTrustedSender(event)) {
      return {
        ok: false,
        error: {
          code: ErrorCode.PERMISSION_DENIED,
          message: 'Request rejected: untrusted IPC sender.'
        }
      }
    }
    try {
      const data = await handler(...(args as never[]))
      return { ok: true, data: data ?? null }
    } catch (error) {
      if (error instanceof AppError) {
        return {
          ok: false,
          error: { code: error.code, message: error.message, details: error.details }
        }
      }
      if (error instanceof ZodError) {
        return {
          ok: false,
          error: { code: ErrorCode.VALIDATION, message: formatZodError(error) }
        }
      }
      console.error(`[ipc:${channel}]`, error)
      return {
        ok: false,
        error: { code: ErrorCode.INTERNAL, message: toErrorMessage(error) }
      }
    }
  })
}

export function getWindowOrThrow(context: IpcContext): BrowserWindow {
  const window = context.getMainWindow()
  if (!window || window.isDestroyed()) {
    throw new AppError(ErrorCode.INTERNAL, 'The main window is not available.')
  }
  return window
}
