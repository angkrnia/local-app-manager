import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
      projectName: 'Nexa',
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
      projectName: 'Ladang',
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
    expect(updated.projectName).toBe('Ladang')
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
})
