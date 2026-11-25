import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import net from 'node:net'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: vi.fn(), openExternal: vi.fn() }
}))

import { MASKED_SECRET } from '@shared/constants'
import { Database } from '../src/main/services/database'
import { ApplicationsRepository } from '../src/main/services/database/repositories/applications'
import { checkHttpHealth, checkTcpHealth } from '../src/main/services/health-check'
import { getActiveProcessCount } from '../src/main/services/process-manager'
import { createTestHarness, findFreePort, type TestHarness } from './helpers/test-env'

describe('Database persistence, Application CRUD, Health Check & Lifecycle', () => {
  let harness: TestHarness

  beforeEach(() => {
    harness = createTestHarness()
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  it('supports full Application CRUD, secret masking, duplication, and SQLite persistence', () => {
    const created = harness.applications.create({
      name: 'Next.js Dashboard',
      projectName: 'Frontend',
      description: 'Local frontend',
      projectDirectory: harness.rootDir,
      workingDirectory: harness.rootDir,
      applicationType: 'nextjs',
      startCommand: `node "${harness.serverScript}"`,
      stopCommand: null,
      localHost: '127.0.0.1',
      localPort: 3456,
      environmentVariables: {
        NODE_ENV: 'development',
        API_SECRET_KEY: 'super-secret-value'
      },
      autoStart: false
    })

    // Sensitive keys are masked in DTO responses
    expect(created.environmentVariables.NODE_ENV).toBe('development')
    expect(created.environmentVariables.API_SECRET_KEY).toBe(MASKED_SECRET)

    // Raw DB value is encrypted, never plaintext
    const rawRecord = harness.applicationsRepo.get(created.id)
    expect(rawRecord?.environmentVariables.API_SECRET_KEY).toMatch(/^enc:v1:/)
    expect(rawRecord?.environmentVariables.API_SECRET_KEY).not.toContain('super-secret-value')

    // Update preserves masked secret
    const updated = harness.applications.update(created.id, {
      name: 'Next.js Dashboard v2',
      projectName: 'Backend',
      description: 'Updated description',
      projectDirectory: harness.rootDir,
      workingDirectory: harness.rootDir,
      applicationType: 'nextjs',
      startCommand: `node "${harness.serverScript}"`,
      stopCommand: null,
      localHost: '127.0.0.1',
      localPort: 3457,
      environmentVariables: {
        NODE_ENV: 'development',
        API_SECRET_KEY: MASKED_SECRET
      },
      autoStart: true
    })
    expect(updated.name).toBe('Next.js Dashboard v2')
    expect(updated.projectName).toBe('Backend')
    expect(updated.localPort).toBe(3457)
    expect(updated.autoStart).toBe(true)

    // Duplicate creates a second distinct record
    const copy = harness.applications.duplicate(created.id)
    expect(copy.id).not.toBe(created.id)
    expect(copy.name).toContain('(Copy)')
    expect(harness.applications.list()).toHaveLength(2)

    // Reorder persists custom order in SQLite
    const reordered = harness.applications.reorder([copy.id, created.id])
    expect(reordered.map((app) => app.id)).toEqual([copy.id, created.id])

    // Persistence check: open a second Database handle on the same SQLite file
    const reopened = new Database(harness.dbPath)
    try {
      const persisted = new ApplicationsRepository(reopened).list()
      expect(persisted).toHaveLength(2)
      expect(persisted.map((app) => app.id)).toEqual([copy.id, created.id])
      expect(persisted.some((app) => app.name === 'Next.js Dashboard v2')).toBe(true)
    } finally {
      reopened.close()
    }

    // Delete removes the duplicate
    return harness.applications.remove(copy.id).then(() => {
      expect(harness.applications.list()).toHaveLength(1)
    })
  })

  it('starts, health-checks, logs, restarts, and cleanly stops a real local HTTP server', async () => {
    const port = await findFreePort()
    const app = harness.applications.create({
      name: 'Real Node Server',
      description: 'Local HTTP test server',
      projectDirectory: harness.rootDir,
      workingDirectory: harness.rootDir,
      applicationType: 'node',
      startCommand: `"${process.execPath}" "${harness.serverScript}" ${port}`,
      stopCommand: null,
      localHost: '127.0.0.1',
      localPort: port,
      environmentVariables: { PORT: String(port) },
      autoStart: false
    })

    const started = await harness.applications.start(app.id)
    expect(started.status).toBe('running')
    expect(started.health).toBe('healthy')
    expect(started.pid).toBeTypeOf('number')

    // Direct HTTP & TCP health checks pass
    const httpHealth = await checkHttpHealth({ host: '127.0.0.1', port, protocol: 'http' })
    expect(httpHealth.healthy).toBe(true)
    expect(httpHealth.statusCode).toBe(200)

    const tcpHealth = await checkTcpHealth('127.0.0.1', port)
    expect(tcpHealth.healthy).toBe(true)

    // Logs captured stdout from the running app
    const logs = harness.logs.query({ source: 'application', applicationId: app.id })
    expect(logs.some((entry) => entry.message.includes('TEST_SERVER_READY'))).toBe(true)

    // Restart assigns a new PID and stays healthy
    const firstPid = started.pid
    const restarted = await harness.applications.restart(app.id)
    expect(restarted.status).toBe('running')
    expect(restarted.pid).not.toBe(firstPid)

    // Stop releases the port and leaves no orphan processes
    const stopped = await harness.applications.stop(app.id)
    expect(stopped.status).toBe('stopped')
    expect(stopped.pid).toBeNull()
    expect(getActiveProcessCount()).toBe(0)
  })

  it('detects port conflicts before starting an application', async () => {
    const port = await findFreePort()
    const blocker = net.createServer()
    await new Promise<void>((resolve) => blocker.listen(port, '127.0.0.1', resolve))

    try {
      const check = await harness.applications.checkPort('127.0.0.1', port)
      expect(check.inUse).toBe(true)
      expect(check.available).toBe(false)

      const app = harness.applications.create({
        name: 'Conflicting App',
        description: '',
        projectDirectory: harness.rootDir,
        workingDirectory: harness.rootDir,
        applicationType: 'node',
        startCommand: `"${process.execPath}" "${harness.serverScript}" ${port}`,
        stopCommand: null,
        localHost: '127.0.0.1',
        localPort: port,
        environmentVariables: {},
        autoStart: false
      })

      await expect(harness.applications.start(app.id)).rejects.toThrow(/already in use/i)
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })

  it('migrates v3 databases to v4 allowing nullable local_port without cascading tunnel deletes', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'tunnel-manager-v3-'))
    const dbFile = join(tempDir, 'legacy.db')
    const raw = new DatabaseSync(dbFile)
    try {
      raw.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE applications (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          project_name TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          project_directory TEXT NOT NULL,
          working_directory TEXT NOT NULL,
          application_type TEXT NOT NULL,
          start_command TEXT NOT NULL,
          stop_command TEXT,
          local_host TEXT NOT NULL DEFAULT '127.0.0.1',
          local_port INTEGER NOT NULL CHECK (local_port BETWEEN 1 AND 65535),
          environment_variables TEXT NOT NULL DEFAULT '{}',
          auto_start INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE tunnels (
          id TEXT PRIMARY KEY,
          application_id TEXT REFERENCES applications (id) ON DELETE CASCADE,
          tunnel_type TEXT NOT NULL CHECK (tunnel_type IN ('quick', 'named')),
          tunnel_name TEXT,
          cloudflare_tunnel_id TEXT,
          hostname TEXT,
          local_url TEXT NOT NULL,
          public_url TEXT,
          status TEXT NOT NULL DEFAULT 'stopped',
          cloudflared_pid INTEGER,
          started_at TEXT,
          last_error TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO applications (
          id, name, project_name, description, project_directory, working_directory,
          application_type, start_command, stop_command, local_host, local_port,
          environment_variables, auto_start, sort_order, created_at, updated_at
        ) VALUES (
          'app-1', 'Legacy App', '', '', 'C:\\app', 'C:\\app',
          'node', 'npm run dev', NULL, '127.0.0.1', 3000,
          '{}', 0, 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        );
        INSERT INTO tunnels (
          id, application_id, tunnel_type, local_url, status, created_at, updated_at
        ) VALUES (
          'tun-1', 'app-1', 'quick', 'http://127.0.0.1:3000', 'stopped', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
        );
        PRAGMA user_version = 3;
      `)
    } finally {
      raw.close()
    }

    const migrated = new Database(dbFile)
    try {
      const versionRow = migrated.prepare('PRAGMA user_version').get() as { user_version: number }
      expect(versionRow.user_version).toBe(4)

      const repo = new ApplicationsRepository(migrated)
      const legacy = repo.get('app-1')
      expect(legacy?.localPort).toBe(3000)

      const tunnelRow = migrated.prepare('SELECT id FROM tunnels WHERE id = ?').get('tun-1') as
        | { id: string }
        | undefined
      expect(tunnelRow?.id).toBe('tun-1')

      const autoApp = repo.create({
        name: 'Auto App',
        projectName: '',
        description: '',
        projectDirectory: tempDir,
        workingDirectory: tempDir,
        applicationType: 'node',
        startCommand: 'npm run dev',
        stopCommand: null,
        localHost: '127.0.0.1',
        localPort: null,
        environmentVariables: {},
        autoStart: false
      })
      expect(autoApp.localPort).toBeNull()
    } finally {
      migrated.close()
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // Ignore transient Windows file lock delays.
      }
    }
  })

  it('auto-detects port from runtime logs when localPort is null and clears it on stop', async () => {
    const port = await findFreePort()
    const app = harness.applications.create({
      name: 'Auto Log Port Server',
      description: '',
      projectDirectory: harness.rootDir,
      workingDirectory: harness.rootDir,
      applicationType: 'node',
      startCommand: `"${process.execPath}" "${harness.serverScript}" ${port}`,
      stopCommand: null,
      localHost: '127.0.0.1',
      localPort: null,
      environmentVariables: {},
      autoStart: false
    })

    expect(app.localPort).toBeNull()
    expect(app.detectedPort).toBeNull()
    expect(app.localUrl).toBeNull()

    const started = await harness.applications.start(app.id)
    expect(started.status).toBe('running')
    expect(started.health).toBe('healthy')
    expect(started.detectedPort).toBe(port)
    expect(started.localUrl).toBe(`http://127.0.0.1:${port}`)

    const stopped = await harness.applications.stop(app.id)
    expect(stopped.status).toBe('stopped')
    expect(stopped.detectedPort).toBeNull()
    expect(stopped.localUrl).toBeNull()
    expect(getActiveProcessCount()).toBe(0)
  })

  it('auto-detects port via process-tree inspection for silent servers with no log output', async () => {
    const port = await findFreePort()
    const silentScript = join(harness.rootDir, 'silent-server.cjs')
    writeFileSync(
      silentScript,
      `
const http = require('node:http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
});
server.listen(${port}, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
`,
      'utf8'
    )

    const app = harness.applications.create({
      name: 'Silent Auto Port Server',
      description: '',
      projectDirectory: harness.rootDir,
      workingDirectory: harness.rootDir,
      applicationType: 'node',
      startCommand: `"${process.execPath}" "${silentScript}"`,
      stopCommand: null,
      localHost: '127.0.0.1',
      localPort: null,
      environmentVariables: {},
      autoStart: false
    })

    const started = await harness.applications.start(app.id)
    expect(started.status).toBe('running')
    expect(started.health).toBe('healthy')
    expect(started.detectedPort).toBe(port)
    expect(started.localUrl).toBe(`http://127.0.0.1:${port}`)

    await harness.applications.stop(app.id)
    expect(getActiveProcessCount()).toBe(0)
  })

  it('connects to an IPv6-only (::1) server even when localHost is 127.0.0.1', async () => {
    const port = await findFreePort()
    const ipv6Script = join(harness.rootDir, 'ipv6-server.cjs')
    writeFileSync(
      ipv6Script,
      `
const http = require('node:http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ipv6-ok');
});
server.listen(${port}, '::1', () => {
  console.log('Local: http://localhost:${port}/');
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
`,
      'utf8'
    )

    const app = harness.applications.create({
      name: 'IPv6 Fixed Port Server',
      description: '',
      projectDirectory: harness.rootDir,
      workingDirectory: harness.rootDir,
      applicationType: 'nuxt',
      startCommand: `"${process.execPath}" "${ipv6Script}"`,
      stopCommand: null,
      localHost: '127.0.0.1',
      localPort: port,
      environmentVariables: {},
      autoStart: false
    })

    const started = await harness.applications.start(app.id)
    expect(started.status).toBe('running')
    expect(started.health).toBe('healthy')
    expect(started.localUrl).toBe(`http://[::1]:${port}`)

    await harness.applications.stop(app.id)
    expect(getActiveProcessCount()).toBe(0)
  })

  it('ignores 426 HMR ports and auto-detects a delayed IPv6 Nuxt-like app port', async () => {
    const hmrPort = await findFreePort()
    const appPort = await findFreePort()
    const nuxtLikeScript = join(harness.rootDir, 'nuxt-like-server.cjs')
    writeFileSync(
      nuxtLikeScript,
      `
const http = require('node:http');
const hmrServer = http.createServer((req, res) => {
  res.writeHead(426, { 'Content-Type': 'text/plain', Upgrade: 'websocket' });
  res.end('Upgrade Required');
});
hmrServer.listen(${hmrPort}, '127.0.0.1');

console.log('  ➜ Local:    http://localhost:${appPort}/');

let appServer = null;
setTimeout(() => {
  appServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html>ok</html>');
  });
  appServer.listen(${appPort}, '::1');
}, 300);

const shutdown = () => {
  hmrServer.close();
  if (appServer) appServer.close(() => process.exit(0));
  else process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
`,
      'utf8'
    )

    const app = harness.applications.create({
      name: 'Nuxt-like Auto Server',
      description: '',
      projectDirectory: harness.rootDir,
      workingDirectory: harness.rootDir,
      applicationType: 'nuxt',
      startCommand: `"${process.execPath}" "${nuxtLikeScript}"`,
      stopCommand: null,
      localHost: '127.0.0.1',
      localPort: null,
      environmentVariables: {},
      autoStart: false
    })

    const started = await harness.applications.start(app.id)
    expect(started.status).toBe('running')
    expect(started.health).toBe('healthy')
    expect(started.detectedPort).toBe(appPort)
    expect(started.localUrl).toBe(`http://[::1]:${appPort}`)

    await harness.applications.stop(app.id)
    expect(getActiveProcessCount()).toBe(0)
  })
})
