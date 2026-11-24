import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openPath: vi.fn(), openExternal: vi.fn() }
}))

import { getActiveProcessCount } from '../src/main/services/process-manager'
import { createTestHarness, findFreePort, type TestHarness } from './helpers/test-env'

describe('Tunnel lifecycle, Multi-tunnel independence & Start & Expose workflow', () => {
  let harness: TestHarness

  beforeEach(() => {
    harness = createTestHarness()
  })

  afterEach(async () => {
    await harness.cleanup()
  })

  it('runs multiple independent tunnels and stops one without affecting the other', async () => {
    const portA = await findFreePort()
    const portB = await findFreePort()

    const appA = harness.applications.create({
      name: 'Service A',
      description: '',
      projectDirectory: harness.rootDir,
      workingDirectory: harness.rootDir,
      applicationType: 'node',
      startCommand: `"${process.execPath}" "${harness.serverScript}" ${portA}`,
      stopCommand: null,
      localHost: '127.0.0.1',
      localPort: portA,
      environmentVariables: {},
      autoStart: false
    })

    const appB = harness.applications.create({
      name: 'Service B',
      description: '',
      projectDirectory: harness.rootDir,
      workingDirectory: harness.rootDir,
      applicationType: 'node',
      startCommand: `"${process.execPath}" "${harness.serverScript}" ${portB}`,
      stopCommand: null,
      localHost: '127.0.0.1',
      localPort: portB,
      environmentVariables: {},
      autoStart: false
    })

    await harness.applications.start(appA.id)
    await harness.applications.start(appB.id)

    const tunnelA = await harness.tunnels.createQuick({ applicationId: appA.id, name: 'Tunnel A' })
    const tunnelB = await harness.tunnels.createQuick({ applicationId: appB.id, name: 'Tunnel B' })

    const startedA = await harness.tunnels.start(tunnelA.id)
    const startedB = await harness.tunnels.start(tunnelB.id)

    expect(startedA.status).toBe('running')
    expect(startedB.status).toBe('running')
    expect(startedA.publicUrl).toMatch(/^https:\/\/.+\.trycloudflare\.com$/)
    expect(startedB.publicUrl).toMatch(/^https:\/\/.+\.trycloudflare\.com$/)
    expect(startedA.publicUrl).not.toBe(startedB.publicUrl)

    // Stopping Tunnel A must NOT stop Tunnel B
    await harness.tunnels.stop(tunnelA.id)
    expect(harness.tunnels.get(tunnelA.id).status).toBe('stopped')
    expect(harness.tunnels.get(tunnelB.id).status).toBe('running')

    // Stop All stops the remaining tunnel
    const batch = await harness.tunnels.stopAll()
    expect(batch.failed).toHaveLength(0)
    expect(harness.tunnels.get(tunnelB.id).status).toBe('stopped')

    await harness.applications.stop(appA.id)
    await harness.applications.stop(appB.id)
    expect(getActiveProcessCount()).toBe(0)
  })

  it('executes Start & Expose end-to-end and Stop Everything cleanly', async () => {
    const port = await findFreePort()
    const app = harness.applications.create({
      name: 'Fullstack App',
      description: '',
      projectDirectory: harness.rootDir,
      workingDirectory: harness.rootDir,
      applicationType: 'vite',
      startCommand: `"${process.execPath}" "${harness.serverScript}" ${port}`,
      stopCommand: null,
      localHost: '127.0.0.1',
      localPort: port,
      environmentVariables: {},
      autoStart: false
    })

    const result = await harness.workflow.startAndExpose(app.id)
    expect(result.application.status).toBe('running')
    expect(result.application.health).toBe('healthy')
    expect(result.tunnel.status).toBe('running')
    expect(result.tunnel.publicUrl).toMatch(/^https:\/\/.+\.trycloudflare\.com$/)

    // Persisted URL in SQLite
    const persisted = harness.tunnelsRepo.get(result.tunnel.id)
    expect(persisted?.publicUrl).toBe(result.tunnel.publicUrl)

    // Stop Everything shuts down both tunnel and app with zero orphans
    const stoppedApp = await harness.workflow.stopEverything(app.id)
    expect(stoppedApp.status).toBe('stopped')
    expect(harness.tunnels.get(result.tunnel.id).status).toBe('stopped')
    expect(getActiveProcessCount()).toBe(0)
  })

  it('aborts tunnel creation if the application fails to start', async () => {
    const port = await findFreePort()
    const app = harness.applications.create({
      name: 'Broken App',
      description: '',
      projectDirectory: harness.rootDir,
      workingDirectory: harness.rootDir,
      applicationType: 'node',
      startCommand: `"${process.execPath}" -e "process.exit(1)"`,
      stopCommand: null,
      localHost: '127.0.0.1',
      localPort: port,
      environmentVariables: {},
      autoStart: false
    })

    await expect(harness.workflow.startAndExpose(app.id)).rejects.toThrow()
    expect(harness.tunnels.listForApplication(app.id)).toHaveLength(0)
    expect(getActiveProcessCount()).toBe(0)
  })

  it('keeps the local application running when tunnel startup fails', async () => {
    const port = await findFreePort()
    const app = harness.applications.create({
      name: 'Resilient App',
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

    harness.cloudflared.shouldFail = true

    await expect(harness.workflow.startAndExpose(app.id)).rejects.toThrow(/cloudflared/i)

    // Local app remains running even though tunnel failed
    expect(harness.applications.get(app.id).status).toBe('running')

    await harness.applications.stop(app.id)
    expect(getActiveProcessCount()).toBe(0)
  })

  it('deletes a named tunnel locally by default without touching Cloudflare remote', async () => {
    const port = await findFreePort()
    const app = harness.applications.create({
      name: 'Named Local Delete App',
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

    harness.cloudflared.authenticated = true
    await harness.cloudflared.createTunnel('my-named-tunnel')
    const tunnel = await harness.tunnels.createNamed({
      applicationId: app.id,
      tunnelName: 'my-named-tunnel',
      hostname: 'app.example.com'
    })

    await harness.tunnels.remove(tunnel.id)
    expect(harness.tunnelsRepo.get(tunnel.id)).toBeNull()
    expect(harness.cloudflared.deletedRemoteTunnels).toHaveLength(0)
  })

  it('deletes a named tunnel on Cloudflare when deleteRemote is true', async () => {
    const port = await findFreePort()
    const app = harness.applications.create({
      name: 'Named Remote Delete App',
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

    harness.cloudflared.authenticated = true
    await harness.cloudflared.createTunnel('remote-delete-tunnel')
    const tunnel = await harness.tunnels.createNamed({
      applicationId: app.id,
      tunnelName: 'remote-delete-tunnel',
      hostname: 'remote.example.com'
    })

    await harness.tunnels.remove(tunnel.id, { deleteRemote: true })
    expect(harness.tunnelsRepo.get(tunnel.id)).toBeNull()
    expect(harness.cloudflared.deletedRemoteTunnels).toEqual(['remote-delete-tunnel'])
  })

  it('preserves local named tunnel record if remote deletion fails', async () => {
    const port = await findFreePort()
    const app = harness.applications.create({
      name: 'Named Failed Remote Delete App',
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

    harness.cloudflared.authenticated = true
    await harness.cloudflared.createTunnel('failing-remote-tunnel')
    const tunnel = await harness.tunnels.createNamed({
      applicationId: app.id,
      tunnelName: 'failing-remote-tunnel',
      hostname: 'fail.example.com'
    })

    harness.cloudflared.deleteRemoteError = new Error('Simulated Cloudflare API failure')
    await expect(harness.tunnels.remove(tunnel.id, { deleteRemote: true })).rejects.toThrow(
      /Simulated Cloudflare API failure/
    )
    expect(harness.tunnelsRepo.get(tunnel.id)).not.toBeNull()
  })

  it('ignores deleteRemote for quick tunnels and deletes locally', async () => {
    const port = await findFreePort()
    const app = harness.applications.create({
      name: 'Quick Delete App',
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

    const tunnel = await harness.tunnels.createQuick({ applicationId: app.id, name: 'Quick One' })
    await harness.tunnels.remove(tunnel.id, { deleteRemote: true })
    expect(harness.tunnelsRepo.get(tunnel.id)).toBeNull()
    expect(harness.cloudflared.deletedRemoteTunnels).toHaveLength(0)
  })

  it('executes Start & Expose with an auto-detected port when localPort is null', async () => {
    const port = await findFreePort()
    const app = harness.applications.create({
      name: 'Auto Expose App',
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

    const result = await harness.workflow.startAndExpose(app.id)
    expect(result.application.status).toBe('running')
    expect(result.application.detectedPort).toBe(port)
    expect(result.application.localUrl).toBe(`http://127.0.0.1:${port}`)
    expect(result.tunnel.status).toBe('running')
    expect(result.tunnel.localUrl).toBe(`http://127.0.0.1:${port}`)
    expect(result.tunnel.publicUrl).toMatch(/^https:\/\/.+\.trycloudflare\.com$/)

    await harness.workflow.stopEverything(app.id)
    expect(getActiveProcessCount()).toBe(0)
  })

  it('rejects starting a tunnel when an auto-detect app is stopped', async () => {
    const port = await findFreePort()
    const app = harness.applications.create({
      name: 'Stopped Auto App',
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

    const tunnel = await harness.tunnels.createQuick({ applicationId: app.id, name: 'Auto Tunnel' })
    expect(tunnel.localUrl).toBe('')

    await expect(harness.tunnels.start(tunnel.id)).rejects.toThrow(
      /auto-detect port and is not running/i
    )
  })
})
