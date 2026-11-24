import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { LineSplitter } from '../../utils/line-splitter'
import { sleep } from '../../utils/net'
import { AppError, ErrorCode, toErrorMessage } from '@shared/errors'
import { killProcessTree, killProcessTreeSync, spawnDirectCommand, spawnShellCommand } from './tree-kill'

export interface ProcessExitInfo {
  code: number | null
  signal: NodeJS.Signals | null
  expected: boolean
  pid: number | null
}

export interface ManagedProcessOptions {
  id: string
  label: string
  command: string
  /** When set, the process is spawned directly instead of through a shell. */
  executable?: string
  args?: string[]
  cwd: string
  env: Record<string, string>
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
  onSpawn?: (pid: number) => void
  onExit?: (info: ProcessExitInfo) => void
  onError?: (error: Error) => void
}

/** Tracks live process ids so nothing survives an application shutdown. */
const activePids = new Set<number>()

export function getActiveProcessCount(): number {
  return activePids.size
}

/**
 * A single independently managed child process. Application and tunnel
 * managers each own their own instances; nothing is shared implicitly.
 */
export class ManagedProcess {
  private child: ChildProcessWithoutNullStreams | null = null
  private readonly stdoutSplitter = new LineSplitter()
  private readonly stderrSplitter = new LineSplitter()
  private stopRequested = false
  private exitResolvers: Array<() => void> = []
  private exited = false
  private pidValue: number | null = null

  constructor(private readonly options: ManagedProcessOptions) {}

  get id(): string {
    return this.options.id
  }

  get label(): string {
    return this.options.label
  }

  get pid(): number | null {
    return this.pidValue
  }

  get running(): boolean {
    return this.child !== null && !this.exited
  }

  get expectedStop(): boolean {
    return this.stopRequested
  }

  spawn(): number {
    if (this.child) {
      throw new AppError(ErrorCode.CONFLICT, `${this.options.label} is already running`)
    }
    this.stopRequested = false
    this.exited = false

    let child: ChildProcessWithoutNullStreams
    try {
      const spawnOptions = {
        cwd: this.options.cwd,
        env: { ...process.env, ...this.options.env, NO_COLOR: '1', FORCE_COLOR: '0' }
      }
      child = (
        this.options.executable
          ? spawnDirectCommand(this.options.executable, this.options.args ?? [], spawnOptions)
          : spawnShellCommand(this.options.command, spawnOptions)
      ) as ChildProcessWithoutNullStreams
    } catch (error) {
      throw new AppError(
        ErrorCode.PROCESS_START_FAILED,
        `Failed to start ${this.options.label}: ${toErrorMessage(error)}`
      )
    }

    this.child = child
    this.pidValue = child.pid ?? null
    if (child.pid) {
      activePids.add(child.pid)
      this.options.onSpawn?.(child.pid)
    }

    child.stdout?.on('data', (buffer: Buffer) => {
      for (const line of this.stdoutSplitter.push(buffer.toString('utf8'))) {
        this.options.onLine?.(line, 'stdout')
      }
    })
    child.stderr?.on('data', (buffer: Buffer) => {
      for (const line of this.stderrSplitter.push(buffer.toString('utf8'))) {
        this.options.onLine?.(line, 'stderr')
      }
    })

    child.on('error', (error) => {
      this.options.onError?.(
        new AppError(
          ErrorCode.PROCESS_START_FAILED,
          `Process ${this.options.label} failed: ${error.message}`,
          error.stack
        )
      )
      this.handleExit(null, null)
    })

    child.on('close', (code, signal) => {
      this.handleExit(code, signal)
    })

    return child.pid ?? 0
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exited) return
    this.exited = true
    const pid = this.pidValue
    if (pid) activePids.delete(pid)

    for (const line of this.stdoutSplitter.flush()) {
      this.options.onLine?.(line, 'stdout')
    }
    for (const line of this.stderrSplitter.flush()) {
      this.options.onLine?.(line, 'stderr')
    }

    this.child = null
    const resolvers = this.exitResolvers
    this.exitResolvers = []
    for (const resolve of resolvers) resolve()

    this.options.onExit?.({
      code,
      signal,
      expected: this.stopRequested,
      pid
    })
  }

  private waitForExit(): Promise<void> {
    if (this.exited) return Promise.resolve()
    return new Promise((resolve) => {
      this.exitResolvers.push(resolve)
    })
  }

  async stop(timeoutMs = 8_000): Promise<void> {
    if (!this.child || this.exited) return
    this.stopRequested = true
    const pid = this.pidValue
    const exitPromise = this.waitForExit()

    if (pid) {
      // Ask the whole tree to terminate first, then force it after a short grace period.
      await killProcessTree(pid, false)
      const graceful = await Promise.race([
        exitPromise.then(() => true),
        sleep(Math.min(2_500, Math.max(500, Math.floor(timeoutMs / 3)))).then(() => false)
      ])
      if (!graceful) {
        await killProcessTree(pid, true)
      }
    } else {
      this.child.kill('SIGTERM')
    }

    const exited = await Promise.race([
      exitPromise.then(() => true),
      sleep(timeoutMs).then(() => false)
    ])
    if (!exited) {
      if (pid) await killProcessTree(pid, true)
      this.child?.kill('SIGKILL')
      // Give the OS a moment to reap the process, but never block forever.
      await Promise.race([exitPromise, sleep(2_000)])
    }
  }

  /** Synchronous best-effort cleanup used while the app is quitting. */
  forceKillSync(): void {
    if (this.pidValue) {
      killProcessTreeSync(this.pidValue)
    }
  }
}

export function forceKillAllTrackedProcesses(): void {
  for (const pid of activePids) {
    killProcessTreeSync(pid)
  }
  activePids.clear()
}
