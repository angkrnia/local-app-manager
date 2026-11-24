import { Menu, Tray, nativeImage, type BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import type { ApplicationManager } from './services/application-manager'
import type { TunnelManager } from './services/tunnel-manager'
import type { EventBus } from './services/event-bus'
import type { SettingsService } from './services/settings'
import { resourcePath } from './utils/resources'

export interface TrayController {
  tray: Tray
  destroy(): void
  refreshMenu(): void
}

export function createTray(options: {
  getWindow: () => BrowserWindow | null
  showWindow: () => void
  quit: () => void
  applications: ApplicationManager
  tunnels: TunnelManager
  settings: SettingsService
  events: EventBus
}): TrayController | null {
  const iconPath = resourcePath('icon.png')
  if (!existsSync(iconPath)) return null
  const image = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
  if (image.isEmpty()) return null

  const tray = new Tray(image)
  tray.setToolTip('Local App Manager')

  const run = (label: string, action: () => Promise<unknown>): void => {
    void action().catch((error: unknown) => {
      options.events.toast({
        type: 'error',
        title: label,
        description: error instanceof Error ? error.message : String(error)
      })
    })
  }

  const buildMenu = (): Menu => {
    return Menu.buildFromTemplate([
      {
        label: 'Open Local App Manager',
        click: () => options.showWindow()
      },
      { type: 'separator' },
      {
        label: 'Start All Applications',
        click: () => {
          for (const application of options.applications.list()) {
            if (application.status !== 'running') {
              run('Could not start application', () => options.applications.start(application.id))
            }
          }
        }
      },
      {
        label: 'Stop All Applications',
        click: () => {
          for (const application of options.applications.list()) {
            if (application.pid !== null) {
              run('Could not stop application', () => options.applications.stop(application.id))
            }
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Start All Tunnels',
        click: () => {
          run('Could not start tunnels', async () => {
            if (!options.settings.get().hasAcceptedPublicWarning) {
              options.showWindow()
              options.events.toast({
                type: 'warning',
                title: 'Public exposure confirmation required',
                description: 'Open the Tunnels page and confirm the public exposure warning first.'
              })
              return
            }
            await options.tunnels.startAll()
          })
        }
      },
      {
        label: 'Stop All Tunnels',
        click: () => run('Could not stop tunnels', () => options.tunnels.stopAll())
      },
      { type: 'separator' },
      {
        label: 'Quit Local App Manager',
        click: () => options.quit()
      }
    ])
  }

  tray.setContextMenu(buildMenu())
  tray.on('click', () => options.showWindow())
  tray.on('double-click', () => options.showWindow())

  return {
    tray,
    destroy: () => tray.destroy(),
    refreshMenu: () => tray.setContextMenu(buildMenu())
  }
}
