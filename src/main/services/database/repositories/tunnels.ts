import { randomUUID } from 'node:crypto'
import type { Database } from '../index'
import type { TunnelRecord } from '../records'
import type { TunnelStatus, TunnelType } from '@shared/types'

interface RawTunnelRow {
  id: string
  application_id: string | null
  application_name: string | null
  tunnel_type: string
  tunnel_name: string | null
  cloudflare_tunnel_id: string | null
  hostname: string | null
  local_url: string
  public_url: string | null
  status: string
  cloudflared_pid: number | null
  started_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

function toRecord(row: RawTunnelRow): TunnelRecord {
  return {
    id: row.id,
    applicationId: row.application_id,
    applicationName: row.application_name,
    tunnelType: row.tunnel_type as TunnelType,
    tunnelName: row.tunnel_name,
    cloudflareTunnelId: row.cloudflare_tunnel_id,
    hostname: row.hostname,
    localUrl: row.local_url,
    publicUrl: row.public_url,
    status: row.status as TunnelStatus,
    cloudflaredPid: row.cloudflared_pid === null ? null : Number(row.cloudflared_pid),
    startedAt: row.started_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const SELECT_WITH_APPLICATION = `
  SELECT t.*, a.name AS application_name
  FROM tunnels t
  LEFT JOIN applications a ON a.id = t.application_id
`

export type TunnelCreateInput = {
  applicationId: string | null
  tunnelType: TunnelType
  tunnelName: string | null
  cloudflareTunnelId: string | null
  hostname: string | null
  localUrl: string
  publicUrl: string | null
  status: TunnelStatus
}

export type TunnelUpdatePatch = Partial<{
  tunnelName: string | null
  cloudflareTunnelId: string | null
  hostname: string | null
  localUrl: string
  publicUrl: string | null
  status: TunnelStatus
  cloudflaredPid: number | null
  startedAt: string | null
  lastError: string | null
}>

const COLUMN_MAP: Record<keyof TunnelUpdatePatch, string> = {
  tunnelName: 'tunnel_name',
  cloudflareTunnelId: 'cloudflare_tunnel_id',
  hostname: 'hostname',
  localUrl: 'local_url',
  publicUrl: 'public_url',
  status: 'status',
  cloudflaredPid: 'cloudflared_pid',
  startedAt: 'started_at',
  lastError: 'last_error'
}

export class TunnelsRepository {
  constructor(private readonly db: Database) {}

  list(): TunnelRecord[] {
    const rows = this.db
      .prepare(`${SELECT_WITH_APPLICATION} ORDER BY t.created_at DESC`)
      .all() as unknown as RawTunnelRow[]
    return rows.map(toRecord)
  }

  listForApplication(applicationId: string): TunnelRecord[] {
    const rows = this.db
      .prepare(`${SELECT_WITH_APPLICATION} WHERE t.application_id = ? ORDER BY t.created_at DESC`)
      .all(applicationId) as unknown as RawTunnelRow[]
    return rows.map(toRecord)
  }

  get(id: string): TunnelRecord | null {
    const row = this.db
      .prepare(`${SELECT_WITH_APPLICATION} WHERE t.id = ?`)
      .get(id) as unknown as RawTunnelRow | undefined
    return row ? toRecord(row) : null
  }

  create(input: TunnelCreateInput): TunnelRecord {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO tunnels (
          id, application_id, tunnel_type, tunnel_name, cloudflare_tunnel_id, hostname,
          local_url, public_url, status, cloudflared_pid, started_at, last_error, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`
      )
      .run(
        id,
        input.applicationId,
        input.tunnelType,
        input.tunnelName,
        input.cloudflareTunnelId,
        input.hostname,
        input.localUrl,
        input.publicUrl,
        input.status,
        now,
        now
      )
    const created = this.get(id)
    if (!created) throw new Error('Failed to read tunnel after insert')
    return created
  }

  update(id: string, patch: TunnelUpdatePatch): TunnelRecord | null {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined) as Array<
      [keyof TunnelUpdatePatch, unknown]
    >
    const sets: string[] = []
    const values: Array<string | number | null> = []
    for (const [key, value] of entries) {
      sets.push(`${COLUMN_MAP[key]} = ?`)
      values.push(value as string | number | null)
    }
    if (sets.length === 0) return this.get(id)
    sets.push('updated_at = ?')
    values.push(new Date().toISOString())
    values.push(id)
    this.db.prepare(`UPDATE tunnels SET ${sets.join(', ')} WHERE id = ?`).run(...values)
    return this.get(id)
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM tunnels WHERE id = ?').run(id)
    return Number(result.changes) > 0
  }

  resetRuntimeState(): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE tunnels SET
          status = 'stopped',
          cloudflared_pid = NULL,
          started_at = NULL,
          public_url = CASE WHEN tunnel_type = 'named' THEN public_url ELSE NULL END,
          last_error = NULL,
          updated_at = ?
        WHERE status <> 'stopped'`
      )
      .run(now)
  }
}
