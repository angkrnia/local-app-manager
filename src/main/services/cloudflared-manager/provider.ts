import type { CloudflaredStatus, NamedAuthStatus, NamedTunnelRemote } from '@shared/types'

export interface CloudflaredBinary {
  executable: string
  args: string[]
  path: string
  version: string
  source: 'settings' | 'managed' | 'system'
}

/**
 * Abstraction used by the tunnel manager so tunnel lifecycle tests can run
 * against a fake cloudflared executable without Electron.
 */
export interface CloudflaredProvider {
  getBinary(force?: boolean): Promise<CloudflaredBinary>
  getStatus(): Promise<CloudflaredStatus>
  getAuthStatus(): NamedAuthStatus
  listTunnels(): Promise<NamedTunnelRemote[]>
  createTunnel(name: string): Promise<NamedTunnelRemote>
  routeDns(name: string, hostname: string): Promise<void>
}
