import { IPC } from '@shared/constants'
import { applicationInputSchema, batchIdsSchema, idSchema, portCheckSchema } from '@shared/validation'
import { handle, type IpcContext } from './helpers'

export function registerApplicationHandlers(context: IpcContext): void {
  const { applications, workflow } = context

  handle(IPC.applications.list, () => applications.list())

  handle(IPC.applications.create, (input: unknown) => {
    const parsed = applicationInputSchema.parse(input)
    return applications.create(parsed)
  })

  handle(IPC.applications.update, (id: unknown, input: unknown) => {
    const parsedId = idSchema.parse(id)
    const parsedInput = applicationInputSchema.parse(input)
    return applications.update(parsedId, parsedInput)
  })

  handle(IPC.applications.remove, async (id: unknown) => {
    await workflow.deleteApplication(idSchema.parse(id))
    return null
  })

  handle(IPC.applications.duplicate, (id: unknown) => applications.duplicate(idSchema.parse(id)))

  handle(IPC.applications.reorder, (ids: unknown) => applications.reorder(batchIdsSchema.parse(ids)))

  handle(IPC.applications.start, (id: unknown) => applications.start(idSchema.parse(id)))

  handle(IPC.applications.stop, (id: unknown) => applications.stop(idSchema.parse(id)))

  handle(IPC.applications.restart, (id: unknown) => applications.restart(idSchema.parse(id)))

  handle(IPC.applications.startAndExpose, (id: unknown) => workflow.startAndExpose(idSchema.parse(id)))

  handle(IPC.applications.stopEverything, (id: unknown) => workflow.stopEverything(idSchema.parse(id)))

  handle(IPC.applications.openDirectory, async (id: unknown) => {
    await applications.openDirectory(idSchema.parse(id))
    return null
  })

  handle(IPC.applications.openLocalUrl, async (id: unknown) => {
    await applications.openLocalUrl(idSchema.parse(id))
    return null
  })

  handle(IPC.applications.checkPort, (host: unknown, port: unknown) => {
    const parsed = portCheckSchema.parse({ host, port })
    return applications.checkPort(parsed.host, parsed.port)
  })
}
