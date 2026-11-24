import { z } from 'zod'
import { IPC } from '@shared/constants'
import {
  batchIdsSchema,
  idSchema,
  namedTunnelCreateRemoteSchema,
  namedTunnelInputSchema,
  quickTunnelInputSchema,
  routeDnsSchema
} from '@shared/validation'
import { handle, type IpcContext } from './helpers'

const acknowledgeSchema = z.boolean().optional().default(false)

export function registerTunnelHandlers(context: IpcContext): void {
  const { tunnels, cloudflared } = context

  handle(IPC.tunnels.list, () => tunnels.list())

  handle(IPC.tunnels.createQuick, (input: unknown) =>
    tunnels.createQuick(quickTunnelInputSchema.parse(input))
  )

  handle(IPC.tunnels.createNamed, (input: unknown) =>
    tunnels.createNamed(namedTunnelInputSchema.parse(input))
  )

  handle(IPC.tunnels.start, (id: unknown, acknowledge: unknown) =>
    tunnels.start(idSchema.parse(id), acknowledgeSchema.parse(acknowledge))
  )

  handle(IPC.tunnels.stop, (id: unknown) => tunnels.stop(idSchema.parse(id)))

  handle(IPC.tunnels.restart, (id: unknown) => tunnels.restart(idSchema.parse(id)))

  handle(IPC.tunnels.remove, async (id: unknown) => {
    await tunnels.remove(idSchema.parse(id))
    return null
  })

  handle(IPC.tunnels.startMany, (ids: unknown) => tunnels.startMany(batchIdsSchema.parse(ids)))

  handle(IPC.tunnels.stopMany, (ids: unknown) => tunnels.stopMany(batchIdsSchema.parse(ids)))

  handle(IPC.tunnels.restartMany, (ids: unknown) => tunnels.restartMany(batchIdsSchema.parse(ids)))

  handle(IPC.tunnels.startAll, () => tunnels.startAll())

  handle(IPC.tunnels.stopAll, () => tunnels.stopAll())

  handle(IPC.tunnels.openPublicUrl, async (id: unknown) => {
    await tunnels.openPublicUrl(idSchema.parse(id))
    return null
  })

  handle(IPC.tunnels.acceptPublicExposure, () => {
    tunnels.acceptPublicExposure()
    return null
  })

  handle(IPC.named.status, () => cloudflared.getAuthStatus())
  handle(IPC.named.login, () => cloudflared.login())
  handle(IPC.named.listRemote, () => cloudflared.listTunnels())

  handle(IPC.named.createRemote, async (input: unknown) => {
    const parsed = namedTunnelCreateRemoteSchema.parse(input)
    return cloudflared.createTunnel(parsed.name)
  })

  handle(IPC.named.routeDns, async (input: unknown) => {
    const parsed = routeDnsSchema.parse(input)
    await cloudflared.routeDns(parsed.tunnelName, parsed.hostname)
    return null
  })
}
