import { app, dialog, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { IPC } from '@shared/constants'
import {
  activityQuerySchema,
  exportLogsSchema,
  externalUrlSchema,
  logClearSchema,
  logQuerySchema,
  openPathSchema,
  portSchema,
  settingsPatchSchema
} from '@shared/validation'
import { AppError, ErrorCode } from '@shared/errors'
import type { SystemInfo } from '@shared/types'
import { findListeningPort, killPortProcess, listListeningPorts } from '../utils/port-info'
import { handle, getWindowOrThrow, type IpcContext } from './helpers'

const optionalPathSchema = z.string().trim().max(1_000).optional()
const fileFiltersSchema = z
  .array(z.object({ name: z.string().max(80), extensions: z.array(z.string().max(20)).max(20) }))
  .max(20)
  .optional()

function sanitizeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim()
}

export function registerSystemHandlers(context: IpcContext): void {
  const { cloudflared, logs, activity, settings, paths, events } = context

  // ------------------------------------------------------------- cloudflared

  handle(IPC.cloudflared.status, () => cloudflared.getStatus())
  handle(IPC.cloudflared.checkForUpdates, () => cloudflared.checkForUpdates())
  handle(IPC.cloudflared.download, () => cloudflared.download())
  handle(IPC.cloudflared.resetBinaryPath, () => cloudflared.resetBinaryPath())

  handle(IPC.cloudflared.selectBinary, async () => {
    const window = context.getMainWindow()
    const options = {
      title: 'Select cloudflared.exe',
      properties: ['openFile'] as const,
      filters: [{ name: 'cloudflared', extensions: ['exe'] }]
    }
    const result = window
      ? await dialog.showOpenDialog(window, { ...options, properties: ['openFile'] })
      : await dialog.showOpenDialog({ ...options, properties: ['openFile'] })
    if (result.canceled || !result.filePaths[0]) {
      return cloudflared.getStatus()
    }
    return cloudflared.useBinary(result.filePaths[0])
  })

  // -------------------------------------------------------------------- logs

  handle(IPC.logs.query, (query: unknown) => logs.query(logQuerySchema.optional().parse(query) ?? {}))

  handle(IPC.logs.clear, async (query: unknown) => {
    const parsed = logClearSchema.parse(query ?? {})
    const keys = logs.clear(parsed)
    await logs.truncateFiles(keys)
    events.logsCleared({
      source: parsed.source ?? 'system',
      applicationId: parsed.applicationId ?? null,
      tunnelId: parsed.tunnelId ?? null
    })
    return null
  })

  handle(IPC.logs.export, async (input: unknown) => {
    const parsed = exportLogsSchema.parse(input)
    const window = getWindowOrThrow(context)
    const content = logs.format({
      source: parsed.source,
      applicationId: parsed.applicationId,
      tunnelId: parsed.tunnelId
    })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const suggested = parsed.suggestedName
      ? sanitizeFileName(basename(parsed.suggestedName))
      : `local-app-manager-${parsed.source}-logs-${stamp}.txt`
    const result = await dialog.showSaveDialog(window, {
      title: 'Save logs',
      defaultPath: join(app.getPath('documents'), suggested.endsWith('.txt') || suggested.endsWith('.log') ? suggested : `${suggested}.txt`),
      filters: [
        { name: 'Log files', extensions: ['txt', 'log'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || !result.filePath) {
      return { saved: false, path: null }
    }
    await writeFile(result.filePath, content.length > 0 ? content : 'No log entries.\r\n', 'utf8')
    return { saved: true, path: result.filePath }
  })

  // ---------------------------------------------------------------- activity

  handle(IPC.activity.list, (query: unknown) =>
    activity.list(activityQuerySchema.optional().parse(query) ?? {})
  )

  handle(IPC.activity.clear, () => {
    activity.clear()
    return null
  })

  // ---------------------------------------------------------------- settings

  handle(IPC.settings.get, () => settings.get())
  handle(IPC.settings.update, (patch: unknown) => settings.update(settingsPatchSchema.parse(patch)))

  // ------------------------------------------------------------------- ports

  handle(IPC.ports.list, () => listListeningPorts())
  handle(IPC.ports.check, (port: unknown) => findListeningPort(portSchema.parse(port)))
  handle(IPC.ports.kill, async (port: unknown) => {
    const parsedPort = portSchema.parse(port)
    const result = await killPortProcess(parsedPort)
    logs.log({
      source: 'system',
      level: 'warn',
      message: `Terminated "${result.processName}" (PID ${result.pid}) on port ${result.port}`
    })
    activity.insert({
      applicationId: null,
      tunnelId: null,
      level: 'warn',
      message: `Killed process "${result.processName}" (PID ${result.pid}) on port ${result.port}`
    })
    return result
  })

  // ------------------------------------------------------------------ system

  handle(IPC.system.info, (): SystemInfo => {
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron ?? 'unknown',
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome ?? 'unknown',
      platform: process.platform,
      arch: process.arch,
      userDataPath: paths.userData,
      databasePath: paths.database,
      logsPath: logs.getDirectory(),
      isPackaged: app.isPackaged
    }
  })

  handle(IPC.system.openPath, async (path: unknown) => {
    const parsed = openPathSchema.parse(path)
    const error = await shell.openPath(parsed)
    if (error) throw new AppError(ErrorCode.INTERNAL, `Could not open path: ${error}`)
    return null
  })

  handle(IPC.system.openExternal, async (url: unknown) => {
    const parsed = externalUrlSchema.parse(url)
    await shell.openExternal(parsed)
    return null
  })

  handle(IPC.system.selectDirectory, async (defaultPath: unknown) => {
    const parsedDefault = optionalPathSchema.parse(defaultPath)
    const window = context.getMainWindow()
    const options = {
      title: 'Select folder',
      properties: ['openDirectory', 'createDirectory'] as Array<
        'openDirectory' | 'createDirectory'
      >,
      defaultPath: parsedDefault
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(IPC.system.selectFile, async (filters: unknown) => {
    const parsedFilters = fileFiltersSchema.parse(filters)
    const window = context.getMainWindow()
    const options = {
      title: 'Select file',
      properties: ['openFile'] as Array<'openFile'>,
      filters: parsedFilters
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(IPC.system.showItemInFolder, (path: unknown) => {
    const parsed = openPathSchema.parse(path)
    shell.showItemInFolder(parsed)
    return null
  })
}
