import { randomUUID } from 'node:crypto'
import type { Database } from '../index'
import type { ProcessSession } from '@shared/types'

interface RawSessionRow {
  id: string
  application_id: string | null
  tunnel_id: string | null
  process_type: string
  pid: number | null
  status: string
  started_at: string
  stopped_at: string | null
  exit_code: number | null
}

function toRecord(row: RawSessionRow): ProcessSession {
  return {
    id: row.id,
    applicationId: row.application_id,
    tunnelId: row.tunnel_id,
    processType: row.process_type as ProcessSession['processType'],
    pid: row.pid === null ? null : Number(row.pid),
    status: row.status as ProcessSession['status'],
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    exitCode: row.exit_code === null ? null : Number(row.exit_code)
  }
}

export class ProcessSessionsRepository {
  constructor(private readonly db: Database) {}

  start(input: {
    applicationId: string | null
    tunnelId: string | null
    processType: ProcessSession['processType']
    pid: number | null
  }): string {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO process_sessions (id, application_id, tunnel_id, process_type, pid, status, started_at)
         VALUES (?, ?, ?, ?, ?, 'running', ?)`
      )
      .run(
        id,
        input.applicationId,
        input.tunnelId,
        input.processType,
        input.pid,
        new Date().toISOString()
      )
    return id
  }

  finish(
    id: string,
    update: { status: ProcessSession['status']; exitCode: number | null }
  ): void {
    this.db
      .prepare('UPDATE process_sessions SET status = ?, exit_code = ?, stopped_at = ? WHERE id = ?')
      .run(update.status, update.exitCode, new Date().toISOString(), id)
  }

  markOrphaned(): number {
    const result = this.db
      .prepare(
        `UPDATE process_sessions SET status = 'orphaned', stopped_at = ?
         WHERE status = 'running'`
      )
      .run(new Date().toISOString())
    return Number(result.changes)
  }

  listRecent(limit = 100): ProcessSession[] {
    const rows = this.db
      .prepare('SELECT * FROM process_sessions ORDER BY started_at DESC LIMIT ?')
      .all(limit) as unknown as RawSessionRow[]
    return rows.map(toRecord)
  }
}
