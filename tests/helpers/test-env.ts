import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import type { CloudflaredStatus, NamedAuthStatus, NamedTunnelRemote } from '@shared/types'
import { Database } from '../../src/main/services/database'
import { ApplicationsRepository } from '../../src/main/services/database/repositories/applications'
import { TunnelsRepository } from '../../src/main/services/database/repositories/tunnels'
import { ProcessSessionsRepository } from '../../src/main/services/database/repositories/process-sessions'
import { ActivityRepository } from '../../src/main/services/database/repositories/activity-logs'
import { SettingsRepository } from '../../src/main/services/database/repositories/settings'
import { SettingsService } from '../../src/main/services/settings'
import { LogManager } from '../../src/main/services/log-manager'
import { EventBus } from '../../src/main/services/event-bus'
import { PlainSecretCodec } from '../../src/main/services/secure-store'
import { ApplicationManager } from '../../src/main/services/application-manager'
import { TunnelManager } from '../../src/main/services/tunnel-manager'
import { WorkflowService } from '../../src/main/services/workflow'
import type { CloudflaredBinary, CloudflaredProvider } from '../../src/main/services/cloudflared-manager/provider'

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

const HTTP_SERVER_SCRIPT = `
const http = require('node:http');
const port = Number(process.env.PORT || process.argv[2] || 3000);
const host = process.env.HOST || '127.0.0.1';
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true, pid: process.pid, port }));
});
server.listen(port, host, () => {
  console.log('TEST_SERVER_READY http://' + host + ':' + port);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
`

const FAKE_CLOUDFLARED_SCRIPT = `
const args = process.argv.slice(2);
if (process.env.FAKE_CF_FAIL === '1') {
  console.error('ERR failed to create quick tunnel: simulated failure');
  process.exit(1);
}
const slug = 'test-' + Math.random().toString(36).slice(2, 10) + '-' + process.pid;
const url = 'https://' + slug + '.trycloudflare.com';
setTimeout(() => {
  console.error('2026-11-20T00:00:00Z INF +--------------------------------------------------------------------------------------------+');
  console.error('2026-11-20T00:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |');
  console.error('2026-11-20T00:00:00Z INF |  ' + url + '                                                   |');
  console.error('2026-11-20T00:00:00Z INF +--------------------------------------------------------------------------------------------+');
}, 120);
const keepAlive = setInterval(() => {}, 10_000);
process.on('SIGTERM', () => { clearInterval(keepAlive); process.exit(0); });
process.on('SIGINT', () => { clearInterval(keepAlive); process.exit(0); });
`

export class FakeCloudflaredProvider implements CloudflaredProvider {
  shouldFail = false
  authenticated = false
  remoteTunnels: NamedTunnelRemote[] = []
  deletedRemoteTunnels: string[] = []
  deleteRemoteError: Error | null = null
  constructor(private readonly scriptPath: string) {}

  async getBinary(): Promise<CloudflaredBinary> {
    if (this.shouldFail) {
      throw new Error('cloudflared is not installed')
    }
    return {
      executable: process.execPath,
      args: [this.scriptPath],
      path: this.scriptPath,
      version: '2026.2.0',
      source: 'managed'
    }
  }

  async getStatus(): Promise<CloudflaredStatus> {
    return {
      available: !this.shouldFail,
      path: this.shouldFail ? null : this.scriptPath,
      version: this.shouldFail ? null : '2026.2.0',
      source: this.shouldFail ? null : 'managed',
      latestVersion: '2026.2.0',
      updateAvailable: false,
      managedPath: this.scriptPath,
      lastCheckedAt: new Date().toISOString(),
      lastError: null,
      checking: false,
      downloading: false
    }
  }

  getAuthStatus(): NamedAuthStatus {
    return { authenticated: this.authenticated, certPath: '', originCertExists: this.authenticated }
  }

  async listTunnels(): Promise<NamedTunnelRemote[]> {
    return [...this.remoteTunnels]
  }

  async createTunnel(name: string): Promise<NamedTunnelRemote> {
    const remote = {
      id: '00000000-0000-0000-0000-000000000001',
      name,
      createdAt: new Date().toISOString(),
      connections: 0
    }
    this.remoteTunnels.push(remote)
    return remote
  }

  async routeDns(): Promise<void> {}

  async deleteTunnel(nameOrId: string): Promise<void> {
    if (this.deleteRemoteError) {
      throw this.deleteRemoteError
    }
    this.deletedRemoteTunnels.push(nameOrId)
    this.remoteTunnels = this.remoteTunnels.filter(
      (tunnel) => tunnel.name !== nameOrId && tunnel.id !== nameOrId
    )
  }
}

export interface TestHarness {
  rootDir: string
  dbPath: string
  logsDir: string
  serverScript: string
  fakeCloudflaredScript: string
  db: Database
  applicationsRepo: ApplicationsRepository
  tunnelsRepo: TunnelsRepository
  sessionsRepo: ProcessSessionsRepository
  activityRepo: ActivityRepository
  settingsRepo: SettingsRepository
  settings: SettingsService
  logs: LogManager
  events: EventBus
  cloudflared: FakeCloudflaredProvider
  applications: ApplicationManager
  tunnels: TunnelManager
  workflow: WorkflowService
  cleanup(): Promise<void>
}

export function createTestHarness(): TestHarness {
  const rootDir = mkdtempSync(join(tmpdir(), 'tunnel-manager-test-'))
  const dbPath = join(rootDir, 'tunnel-manager.db')
  const logsDir = join(rootDir, 'logs')
  const serverScript = join(rootDir, 'http-server.cjs')
  const fakeCloudflaredScript = join(rootDir, 'fake-cloudflared.cjs')

  writeFileSync(serverScript, HTTP_SERVER_SCRIPT, 'utf8')
  writeFileSync(fakeCloudflaredScript, FAKE_CLOUDFLARED_SCRIPT, 'utf8')

  const db = new Database(dbPath)
  const applicationsRepo = new ApplicationsRepository(db)
  const tunnelsRepo = new TunnelsRepository(db)
  const sessionsRepo = new ProcessSessionsRepository(db)
  const activityRepo = new ActivityRepository(db)
  const settingsRepo = new SettingsRepository(db)
  const settings = new SettingsService(settingsRepo)
  settings.update({
    appStartupTimeoutMs: 15_000,
    tunnelStartupTimeoutMs: 15_000,
    healthCheckIntervalMs: 30_000,
    processTerminationTimeoutMs: 3_000,
    hasAcceptedPublicWarning: true
  })

  const events = new EventBus()
  const logs = new LogManager({ directory: logsDir, maxEntriesPerSource: 1_000 })
  const codec = new PlainSecretCodec()
  const cloudflared = new FakeCloudflaredProvider(fakeCloudflaredScript)

  const applications = new ApplicationManager({
    repository: applicationsRepo,
    sessions: sessionsRepo,
    activity: activityRepo,
    settings,
    logs,
    events,
    codec
  })

  const tunnels = new TunnelManager({
    repository: tunnelsRepo,
    applications,
    sessions: sessionsRepo,
    activity: activityRepo,
    settings,
    logs,
    events,
    cloudflared,
    workingDirectory: rootDir
  })

  const workflow = new WorkflowService({
    applications,
    tunnels,
    settings,
    events,
    logs,
    activity: activityRepo
  })

  return {
    rootDir,
    dbPath,
    logsDir,
    serverScript,
    fakeCloudflaredScript,
    db,
    applicationsRepo,
    tunnelsRepo,
    sessionsRepo,
    activityRepo,
    settingsRepo,
    settings,
    logs,
    events,
    cloudflared,
    applications,
    tunnels,
    workflow,
    async cleanup() {
      await tunnels.shutdown()
      await applications.shutdown()
      await logs.close()
      db.close()
      try {
        rmSync(rootDir, { recursive: true, force: true })
      } catch {
        // Ignore transient Windows file handle release delays.
      }
    }
  }
}
