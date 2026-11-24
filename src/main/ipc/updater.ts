import { IPC } from '@shared/constants'
import { handle, type IpcContext } from './helpers'

export function registerUpdaterHandlers(context: IpcContext): void {
  const { updater } = context

  handle(IPC.updater.status, () => updater.getStatus())
  handle(IPC.updater.check, () => updater.check())
  handle(IPC.updater.download, () => updater.download())
  handle(IPC.updater.install, () => {
    updater.install()
    return null
  })
  handle(IPC.updater.openReleasePage, async () => {
    await updater.openReleasePage()
    return null
  })
}
