import { spawn } from 'node:child_process'
import { runCommand } from '../../utils/exec'

/** Kills a process and all of its descendants on Windows. */
export async function killProcessTree(pid: number, force: boolean): Promise<void> {
  if (process.platform === 'win32') {
    const args = ['/PID', String(pid), '/T']
    if (force) args.push('/F')
    const result = await runCommand('taskkill', args, { timeoutMs: 10_000 }).catch(() => null)
    // Exit code 128 means the process was already gone, which is fine.
    if (result && result.code !== 0 && result.code !== 128) {
      // Fall through to a direct kill below when taskkill could not terminate it.
    }
    return
  }

  try {
    process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch {
    try {
      process.kill(pid, force ? 'SIGKILL' : 'SIGTERM')
    } catch {
      // Process already exited.
    }
  }
}

export function killProcessTreeSync(pid: number): void {
  try {
    if (process.platform === 'win32') {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { spawnSync } = require('node:child_process') as typeof import('node:child_process')
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 5_000 })
    } else {
      process.kill(-pid, 'SIGKILL')
    }
  } catch {
    // Best-effort cleanup during shutdown.
  }
}

export function spawnShellCommand(
  command: string,
  options: { cwd: string; env: NodeJS.ProcessEnv }
): ReturnType<typeof spawn> {
  return spawn(command, {
    cwd: options.cwd,
    env: options.env,
    shell: true,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  })
}

export function spawnDirectCommand(
  executable: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): ReturnType<typeof spawn> {
  return spawn(executable, args, {
    cwd: options.cwd,
    env: options.env,
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  })
}
