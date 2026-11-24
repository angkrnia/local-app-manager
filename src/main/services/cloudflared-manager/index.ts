import { spawn } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { open, readFile, rename, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { net, shell } from 'electron'
import type {
  CloudflaredDownloadProgress,
  CloudflaredStatus,
  NamedAuthStatus,
  NamedTunnelRemote
} from '@shared/types'
import {
  CLOUDFLARED_COMMON_PATHS,
  CLOUDFLARED_DOWNLOAD_URLS,
  CLOUDFLARED_MIN_BINARY_BYTES,
  CLOUDFLARED_RELEASES_API
} from '@shared/constants'
import { AppError, ErrorCode, toErrorMessage } from '@shared/errors'
import { findExecutableOnPath, runCommand } from '../../utils/exec'
import { isFile, pathExists, ensureDirectory } from '../../utils/paths'
import type { AppPaths } from '../../utils/paths'
import { killProcessTree } from '../process-manager/tree-kill'
import type { SettingsService } from '../settings'
import type { EventBus } from '../event-bus'
import type { LogManager } from '../log-manager'
import type { ActivityRepository } from '../database/repositories/activity-logs'
import type { CloudflaredBinary, CloudflaredProvider } from './provider'
import { isNewerVersion, parseCloudflaredVersion } from '../tunnel-manager/url-detector'

interface ResolvedState {
  binary: CloudflaredBinary | null
  checkedAt: number
  error: string | null
}

const RESOLVE_TTL_MS = 60_000

export class CloudflaredManager implements CloudflaredProvider {
  private resolved: ResolvedState | null = null
  private resolving: Promise<CloudflaredBinary | null> | null = null
  private latestVersion: string | null = null
  private lastCheckedAt: string | null = null
  private checking = false
  private downloading = false
  private lastError: string | null = null

  constructor(
    private readonly deps: {
      paths: AppPaths
      settings: SettingsService
      events: EventBus
      logs: LogManager
      activity: ActivityRepository
    }
  ) {}

  getManagedPath(): string {
    return this.deps.paths.managedCloudflared
  }

  getAuthStatus(): NamedAuthStatus {
    const certPath = join(homedir(), '.cloudflared', 'cert.pem')
    const exists = existsSync(certPath)
    return { authenticated: exists, certPath, originCertExists: exists }
  }

  async getStatus(): Promise<CloudflaredStatus> {
    const binary = await this.resolve()
    return {
      available: binary !== null,
      path: binary?.path ?? null,
      version: binary?.version ?? null,
      source: binary?.source ?? null,
      latestVersion: this.latestVersion,
      updateAvailable:
        binary !== null && this.latestVersion !== null
          ? isNewerVersion(this.latestVersion, binary.version)
          : false,
      managedPath: this.getManagedPath(),
      lastCheckedAt: this.lastCheckedAt,
      lastError: this.lastError,
      checking: this.checking,
      downloading: this.downloading
    }
  }

  /** Re-runs binary detection and notifies the renderer. */
  async refresh(): Promise<CloudflaredStatus> {
    await this.resolve(true)
    const status = await this.getStatus()
    this.deps.events.cloudflaredStatus(status)
    return status
  }

  async getBinary(force = false): Promise<CloudflaredBinary> {
    const binary = await this.resolve(force)
    if (!binary) {
      throw new AppError(
        ErrorCode.CLOUDFLARED_NOT_FOUND,
        'cloudflared was not found. Download it from the Tunnels page or select an existing cloudflared.exe in Settings.',
        this.lastError ?? undefined
      )
    }
    return binary
  }

  private async resolve(force = false): Promise<CloudflaredBinary | null> {
    if (
      !force &&
      this.resolved &&
      Date.now() - this.resolved.checkedAt < RESOLVE_TTL_MS
    ) {
      return this.resolved.binary
    }
    if (this.resolving) return this.resolving

    this.resolving = this.resolveCandidates()
      .then((result) => {
        this.resolved = { ...result, checkedAt: Date.now() }
        this.lastError = result.error
        return result.binary
      })
      .finally(() => {
        this.resolving = null
      })
    return this.resolving
  }

  private async resolveCandidates(): Promise<{ binary: CloudflaredBinary | null; error: string | null }> {
    const configuredPath = this.deps.settings.get().cloudflaredPath
    const candidates: Array<{ path: string; source: 'settings' | 'managed' | 'system' }> = []
    const errors: string[] = []

    if (configuredPath) candidates.push({ path: configuredPath, source: 'settings' })
    candidates.push({ path: this.getManagedPath(), source: 'managed' })

    const onPath = await findExecutableOnPath('cloudflared').catch(() => null)
    if (onPath) candidates.push({ path: onPath, source: 'system' })
    for (const common of CLOUDFLARED_COMMON_PATHS) {
      candidates.push({ path: common, source: 'system' })
    }

    const seen = new Set<string>()
    for (const candidate of candidates) {
      const normalized = candidate.path.toLowerCase()
      if (seen.has(normalized)) continue
      seen.add(normalized)
      if (!isFile(candidate.path)) {
        if (candidate.source === 'settings') {
          errors.push(`Configured cloudflared path does not exist: ${candidate.path}`)
        }
        continue
      }
      const binary = await this.verifyBinary(candidate.path, candidate.source)
      if (binary) {
        return { binary, error: errors.length > 0 ? errors.join(' ') : null }
      }
      errors.push(`The file at ${candidate.path} is not a working cloudflared binary.`)
    }

    return {
      binary: null,
      error:
        errors.length > 0
          ? errors.join(' ')
          : 'cloudflared was not found on PATH, in the application data folder, or in the default install locations.'
    }
  }

  private async verifyBinary(
    path: string,
    source: 'settings' | 'managed' | 'system'
  ): Promise<CloudflaredBinary | null> {
    const result = await runCommand(path, ['--version'], { timeoutMs: 15_000 }).catch(() => null)
    if (!result) return null
    const version = parseCloudflaredVersion(`${result.stdout}\n${result.stderr}`)
    if (!version) return null
    return { executable: path, args: [], path, version, source }
  }

  async useBinary(path: string): Promise<CloudflaredStatus> {
    if (!isFile(path)) {
      throw new AppError(ErrorCode.VALIDATION, `File not found: ${path}`)
    }
    const binary = await this.verifyBinary(path, 'settings')
    if (!binary) {
      throw new AppError(
        ErrorCode.VALIDATION,
        'The selected file is not a working cloudflared binary. Choose cloudflared.exe.'
      )
    }
    this.deps.settings.update({ cloudflaredPath: path })
    this.resolved = { binary, checkedAt: Date.now(), error: null }
    this.lastError = null
    await this.broadcastStatus()
    return this.getStatus()
  }

  async resetBinaryPath(): Promise<CloudflaredStatus> {
    this.deps.settings.update({ cloudflaredPath: '' })
    await this.resolve(true)
    await this.broadcastStatus()
    return this.getStatus()
  }

  async download(): Promise<CloudflaredStatus> {
    if (this.downloading) {
      throw new AppError(ErrorCode.CONFLICT, 'A cloudflared download is already in progress.')
    }
    this.downloading = true
    await this.broadcastStatus()

    const arch = process.arch === 'ia32' ? 'ia32' : process.arch === 'arm64' ? 'arm64' : 'x64'
    const url = CLOUDFLARED_DOWNLOAD_URLS[arch]
    if (!url) {
      this.downloading = false
      await this.broadcastStatus()
      throw new AppError(ErrorCode.UNSUPPORTED_PLATFORM, `Unsupported CPU architecture: ${process.arch}`)
    }

    ensureDirectory(this.deps.paths.cloudflaredDir)
    const tempPath = join(this.deps.paths.cloudflaredDir, `cloudflared-download-${Date.now()}.exe`)
    let received = 0
    let total: number | null = null

    try {
      const response = await net.fetch(url, {
        headers: { 'User-Agent': 'TunnelManager/1.0' },
        signal: AbortSignal.timeout(300_000)
      })
      if (!response.ok || !response.body) {
        throw new Error(`The download server responded with HTTP ${response.status}.`)
      }
      const lengthHeader = response.headers.get('content-length')
      total = lengthHeader ? Number(lengthHeader) : null

      const file = createWriteStream(tempPath)
      const reader = response.body.getReader()
      let lastProgressAt = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        received += value.byteLength
        if (!file.write(Buffer.from(value))) {
          await once(file, 'drain')
        }
        const now = Date.now()
        if (now - lastProgressAt > 200) {
          lastProgressAt = now
          this.emitProgress(received, total)
        }
      }
      await new Promise<void>((resolve, reject) => {
        file.end((error?: Error | null) => (error ? reject(error) : resolve()))
      })
      this.emitProgress(received, total)

      const info = await stat(tempPath)
      if (info.size < CLOUDFLARED_MIN_BINARY_BYTES) {
        throw new Error(`Downloaded file is unexpectedly small (${info.size} bytes).`)
      }
      const handle = await open(tempPath, 'r')
      try {
        const header = Buffer.alloc(2)
        await handle.read(header, 0, 2, 0)
        if (header.toString('ascii') !== 'MZ') {
          throw new Error('The downloaded file is not a valid Windows executable.')
        }
      } finally {
        await handle.close()
      }

      const verification = await runCommand(tempPath, ['--version'], { timeoutMs: 20_000 })
      const version = parseCloudflaredVersion(`${verification.stdout}\n${verification.stderr}`)
      if (!version) {
        throw new Error('The downloaded binary did not report a valid cloudflared version.')
      }

      const target = this.getManagedPath()
      if (pathExists(target)) {
        try {
          await unlink(target)
        } catch (error) {
          throw new Error(
            `Could not replace the existing cloudflared binary. Stop all tunnels and try again. (${toErrorMessage(error)})`
          )
        }
      }
      await rename(tempPath, target)
      this.deps.settings.update({ cloudflaredPath: '' })
      this.resolved = {
        binary: { executable: target, args: [], path: target, version, source: 'managed' },
        checkedAt: Date.now(),
        error: null
      }
      this.lastError = null
      this.deps.activity.insert({
        applicationId: null,
        tunnelId: null,
        level: 'info',
        message: `cloudflared ${version} was downloaded`
      })
      this.deps.events.toast({
        type: 'success',
        title: 'cloudflared installed',
        description: `Version ${version} is ready to use.`
      })
      this.deps.logs.log({
        source: 'system',
        level: 'info',
        message: `cloudflared ${version} downloaded to ${target}`
      })
      return this.getStatus()
    } catch (error) {
      await unlink(tempPath).catch(() => undefined)
      const message =
        error instanceof AppError ? error.message : `cloudflared download failed: ${toErrorMessage(error)}`
      this.lastError = message
      throw error instanceof AppError
        ? error
        : new AppError(
            ErrorCode.CLOUDFLARED_DOWNLOAD_FAILED,
            `${message} Check your internet connection and try again.`
          )
    } finally {
      this.downloading = false
      await this.broadcastStatus()
    }
  }

  async checkForUpdates(): Promise<CloudflaredStatus> {
    if (this.checking) return this.getStatus()
    this.checking = true
    await this.broadcastStatus()
    try {
      const response = await net.fetch(CLOUDFLARED_RELEASES_API, {
        headers: {
          'User-Agent': 'TunnelManager/1.0',
          Accept: 'application/vnd.github+json'
        },
        signal: AbortSignal.timeout(20_000)
      })
      if (!response.ok) {
        throw new AppError(
          ErrorCode.NETWORK_ERROR,
          `GitHub returned HTTP ${response.status} while checking for cloudflared updates.`
        )
      }
      const data = (await response.json()) as { tag_name?: string }
      const tag = data.tag_name?.replace(/^v/i, '') ?? null
      if (!tag) {
        throw new AppError(ErrorCode.NETWORK_ERROR, 'The release response did not contain a version tag.')
      }
      this.latestVersion = tag
      this.lastCheckedAt = new Date().toISOString()
      return this.getStatus()
    } catch (error) {
      if (error instanceof AppError) throw error
      throw new AppError(
        ErrorCode.NETWORK_ERROR,
        `Could not check for cloudflared updates: ${toErrorMessage(error)}`
      )
    } finally {
      this.checking = false
      await this.broadcastStatus()
    }
  }

  async listTunnels(): Promise<NamedTunnelRemote[]> {
    const binary = await this.getBinary()
    this.assertAuthenticated()
    const result = await runCommand(
      binary.executable,
      [...binary.args, 'tunnel', 'list', '--output', 'json'],
      { timeoutMs: 40_000 }
    )
    if (result.code !== 0) {
      const detail = `${result.stderr}\n${result.stdout}`.trim()
      if (/cert\.pem|login|not authenticated|unauthorized/i.test(detail)) {
        throw new AppError(
          ErrorCode.CLOUDFLARE_NOT_AUTHENTICATED,
          'Cloudflare authentication is missing or expired. Sign in to Cloudflare again.'
        )
      }
      throw new AppError(
        ErrorCode.CLOUDFLARE_COMMAND_FAILED,
        'Could not list Cloudflare tunnels.',
        detail.slice(0, 2_000)
      )
    }

    const raw = result.stdout.trim()
    if (!raw) return []
    const start = raw.indexOf('[')
    const end = raw.lastIndexOf(']')
    if (start === -1 || end === -1) {
      throw new AppError(
        ErrorCode.CLOUDFLARE_COMMAND_FAILED,
        'cloudflared returned an unexpected tunnel list format.',
        raw.slice(0, 2_000)
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw.slice(start, end + 1))
    } catch (error) {
      throw new AppError(
        ErrorCode.CLOUDFLARE_COMMAND_FAILED,
        'Could not parse the Cloudflare tunnel list.',
        toErrorMessage(error)
      )
    }
    if (!Array.isArray(parsed)) return []

    return parsed.map((item) => {
      const entry = item as Record<string, unknown>
      const connections = entry.connections
      return {
        id: String(entry.id ?? ''),
        name: String(entry.name ?? ''),
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
        connections: Array.isArray(connections) ? connections.length : null
      }
    })
  }

  async createTunnel(name: string): Promise<NamedTunnelRemote> {
    const binary = await this.getBinary()
    this.assertAuthenticated()
    const result = await runCommand(binary.executable, [...binary.args, 'tunnel', 'create', name], {
      timeoutMs: 60_000
    })
    const combined = `${result.stdout}\n${result.stderr}`
    if (result.code !== 0) {
      throw new AppError(
        ErrorCode.CLOUDFLARE_COMMAND_FAILED,
        /already exists/i.test(combined)
          ? `A tunnel named "${name}" already exists in your Cloudflare account.`
          : `Could not create the Cloudflare tunnel "${name}".`,
        combined.trim().slice(0, 2_000)
      )
    }
    const idMatch = combined.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    )
    this.deps.activity.insert({
      applicationId: null,
      tunnelId: null,
      level: 'info',
      message: `Created named tunnel "${name}"`
    })
    return {
      id: idMatch?.[0] ?? '',
      name,
      createdAt: new Date().toISOString(),
      connections: 0
    }
  }

  async routeDns(name: string, hostname: string): Promise<void> {
    const binary = await this.getBinary()
    this.assertAuthenticated()
    const result = await runCommand(
      binary.executable,
      [...binary.args, 'tunnel', 'route', 'dns', '--overwrite-dns', name, hostname],
      { timeoutMs: 60_000 }
    )
    const combined = `${result.stdout}\n${result.stderr}`
    if (result.code !== 0 && !/already exists|already configured|record with that host already exists/i.test(combined)) {
      throw new AppError(
        ErrorCode.CLOUDFLARE_COMMAND_FAILED,
        `Could not create the DNS route for ${hostname}.`,
        combined.trim().slice(0, 2_000)
      )
    }
  }

  async deleteTunnel(nameOrId: string): Promise<void> {
    const binary = await this.getBinary()
    this.assertAuthenticated()

    const cleanup = await runCommand(
      binary.executable,
      [...binary.args, 'tunnel', 'cleanup', nameOrId],
      { timeoutMs: 30_000 }
    )
    const cleanupOutput = `${cleanup.stdout}\n${cleanup.stderr}`
    if (cleanup.code !== 0 && /cert\.pem|login|not authenticated|unauthorized/i.test(cleanupOutput)) {
      throw new AppError(
        ErrorCode.CLOUDFLARE_NOT_AUTHENTICATED,
        'Cloudflare authentication is missing or expired. Sign in to Cloudflare again.'
      )
    }

    const result = await runCommand(
      binary.executable,
      [...binary.args, 'tunnel', 'delete', '-f', nameOrId],
      { timeoutMs: 45_000 }
    )
    const combined = `${result.stdout}\n${result.stderr}`
    if (result.code !== 0) {
      if (/not found|no such tunnel|does not exist|could not find/i.test(combined)) {
        this.deps.logs.log({
          source: 'system',
          level: 'info',
          message: `Remote Cloudflare tunnel "${nameOrId}" was already removed or not found`
        })
        return
      }
      if (/cert\.pem|login|not authenticated|unauthorized/i.test(combined)) {
        throw new AppError(
          ErrorCode.CLOUDFLARE_NOT_AUTHENTICATED,
          'Cloudflare authentication is missing or expired. Sign in to Cloudflare again.'
        )
      }
      throw new AppError(
        ErrorCode.CLOUDFLARE_COMMAND_FAILED,
        `Could not delete remote Cloudflare tunnel "${nameOrId}".`,
        combined.trim().slice(0, 2_000)
      )
    }

    this.deps.logs.log({
      source: 'system',
      level: 'info',
      message: `Deleted remote Cloudflare tunnel "${nameOrId}"`
    })
  }

  async login(): Promise<NamedAuthStatus> {
    if (this.getAuthStatus().authenticated) return this.getAuthStatus()
    const binary = await this.getBinary()

    this.deps.logs.log({
      source: 'system',
      level: 'info',
      message: 'Starting Cloudflare login. Complete the authorization in your browser.'
    })
    this.deps.events.toast({
      type: 'info',
      title: 'Cloudflare login',
      description: 'Complete the authorization in the browser window that opens.'
    })

    const child = spawn(binary.executable, [...binary.args, 'tunnel', 'login'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' }
    })

    let output = ''
    const onData = (buffer: Buffer): void => {
      const text = buffer.toString('utf8')
      output += text
      if (output.length > 20_000) output = output.slice(-20_000)
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed) {
          this.deps.logs.log({ source: 'system', level: 'info', message: trimmed })
        }
        const urlMatch = trimmed.match(/https:\/\/dash\.cloudflare\.com\/\S+/)
        if (urlMatch?.[0]) {
          void shell.openExternal(urlMatch[0]).catch(() => undefined)
        }
      }
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)

    let exited = false
    let exitCode: number | null = null
    child.on('exit', (code) => {
      exited = true
      exitCode = code
    })

    const deadline = Date.now() + 300_000
    try {
      while (Date.now() < deadline) {
        if (this.getAuthStatus().authenticated) {
          this.deps.activity.insert({
            applicationId: null,
            tunnelId: null,
            level: 'info',
            message: 'Cloudflare account authenticated'
          })
          this.deps.events.toast({
            type: 'success',
            title: 'Cloudflare connected',
            description: 'You can now manage named tunnels.'
          })
          return this.getAuthStatus()
        }
        if (exited) break
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
    } finally {
      if (!exited && child.pid) {
        await killProcessTree(child.pid, true)
      }
    }

    throw new AppError(
      ErrorCode.CLOUDFLARE_AUTH_FAILED,
      this.getAuthStatus().authenticated
        ? 'Cloudflare authentication was completed.'
        : `Cloudflare login did not complete${exitCode !== null ? ` (cloudflared exited with code ${exitCode})` : ' within 5 minutes'}. ` +
            'Run "cloudflared tunnel login" in a terminal to see the full error, then try again.',
      output.trim().slice(-2_000)
    )
  }

  private assertAuthenticated(): void {
    if (!this.getAuthStatus().authenticated) {
      throw new AppError(
        ErrorCode.CLOUDFLARE_NOT_AUTHENTICATED,
        'Connect your Cloudflare account first. Click "Sign in to Cloudflare" on the Tunnels page.'
      )
    }
  }

  private emitProgress(received: number, total: number | null): void {
    const progress: CloudflaredDownloadProgress = {
      receivedBytes: received,
      totalBytes: total,
      percent: total && total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null
    }
    this.deps.events.downloadProgress(progress)
  }

  private async broadcastStatus(): Promise<void> {
    try {
      const status = await this.getStatus()
      this.deps.events.cloudflaredStatus(status)
    } catch {
      // Status broadcasting is best effort.
    }
  }
}
