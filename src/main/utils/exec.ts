import { spawn } from 'node:child_process'

export interface CommandResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

export interface RunCommandOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
  maxOutputBytes?: number
}

/**
 * Runs a binary directly (never through a shell) and captures its output.
 * Used for cloudflared management commands and system probes.
 */
export function runCommand(
  executable: string,
  args: string[],
  options: RunCommandOptions = {}
): Promise<CommandResult> {
  const timeoutMs = options.timeoutMs ?? 30_000
  const maxOutputBytes = options.maxOutputBytes ?? 2 * 1024 * 1024

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false

    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const finish = (result: CommandResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
      setTimeout(() => finish({ code: null, stdout, stderr, timedOut: true }), 2_000).unref()
    }, timeoutMs)

    child.stdout?.on('data', (buffer: Buffer) => {
      if (stdout.length < maxOutputBytes) stdout += buffer.toString('utf8')
    })
    child.stderr?.on('data', (buffer: Buffer) => {
      if (stderr.length < maxOutputBytes) stderr += buffer.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        reject(error)
      }
    })
    child.on('close', (code) => {
      finish({ code, stdout, stderr, timedOut })
    })
  })
}

export async function findExecutableOnPath(binary: string): Promise<string | null> {
  if (process.platform !== 'win32') {
    const result = await runCommand('which', [binary]).catch(() => null)
    return result && result.code === 0 ? result.stdout.trim().split('\n')[0]?.trim() ?? null : null
  }
  const result = await runCommand('where.exe', [binary]).catch(() => null)
  if (!result || result.code !== 0) return null
  const first = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().endsWith('.exe'))
  return first ?? null
}
