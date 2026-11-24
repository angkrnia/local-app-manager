import { BrowserWindow } from 'electron'
import type { ActivityLog, Application, LogEntry, ToastPayload, Tunnel } from '@shared/types'
import { IPC } from '@shared/constants'

/** Fans out typed events to every renderer window. */
export class EventBus {
  private logBuffer: LogEntry[] = []
  private logFlushTimer: NodeJS.Timeout | null = null

  send(channel: string, payload: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(channel, payload)
      }
    }
  }

  applicationsChanged(applications: Application[]): void {
    this.send(IPC.events.applicationsChanged, applications)
  }

  tunnelsChanged(tunnels: Tunnel[]): void {
    this.send(IPC.events.tunnelsChanged, tunnels)
  }

  /**
   * Buffers log entries and flushes them in batches. A chatty dev server can
   * emit dozens of lines per second; sending one IPC message per line makes the
   * renderer re-render just as often.
   */
  log(entry: LogEntry): void {
    this.logBuffer.push(entry)
    if (this.logBuffer.length >= 200) {
      this.flushLogs()
      return
    }
    if (!this.logFlushTimer) {
      this.logFlushTimer = setTimeout(() => this.flushLogs(), 150)
      this.logFlushTimer.unref?.()
    }
  }

  flushLogs(): void {
    if (this.logFlushTimer) {
      clearTimeout(this.logFlushTimer)
      this.logFlushTimer = null
    }
    if (this.logBuffer.length === 0) return
    const batch = this.logBuffer
    this.logBuffer = []
    // Skip IPC log streaming when no window is visible; LogViewer loads history via logs.query().
    for (const window of BrowserWindow.getAllWindows()) {
      if (
        !window.isDestroyed() &&
        !window.webContents.isDestroyed() &&
        window.isVisible() &&
        !window.isMinimized()
      ) {
        window.webContents.send(IPC.events.logs, batch)
      }
    }
  }

  logsCleared(payload: { source: string; applicationId: string | null; tunnelId: string | null }): void {
    this.send(IPC.events.logsCleared, payload)
  }

  activity(activity: ActivityLog): void {
    this.send(IPC.events.activity, activity)
  }

  toast(toast: ToastPayload): void {
    this.send(IPC.events.toast, toast)
  }

  workflow(progress: unknown): void {
    this.send(IPC.events.workflow, progress)
  }

  cloudflaredStatus(status: unknown): void {
    this.send(IPC.events.cloudflaredStatus, status)
  }

  downloadProgress(progress: unknown): void {
    this.send(IPC.events.downloadProgress, progress)
  }

  updaterStatus(status: unknown): void {
    this.send(IPC.events.updaterStatus, status)
  }
}
