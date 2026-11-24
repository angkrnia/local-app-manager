import type { IpcContext } from './helpers'
import { registerApplicationHandlers } from './applications'
import { registerTunnelHandlers } from './tunnels'
import { registerSystemHandlers } from './system'
import { registerUpdaterHandlers } from './updater'

export function registerIpcHandlers(context: IpcContext): void {
  registerApplicationHandlers(context)
  registerTunnelHandlers(context)
  registerSystemHandlers(context)
  registerUpdaterHandlers(context)
}

export type { IpcContext }
