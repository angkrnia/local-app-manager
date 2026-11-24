import { randomUUID } from 'node:crypto'
import type { Database } from '../index'
import type { ActivityLog, ActivityQuery, LogLevel } from '@shared/types'

interface RawActivityRow {
  id: string
  application_id: string | null
  tunnel_id: string | null
  level: string
  message: string
  created_at: string
  application_name: string | null
  tunnel_name: string | null
}

function toRecord(row: RawActivityRow): ActivityLog {
  return {
    id: row.id,
    applicationId: row.application_id,
    tunnelId: row.tunnel_id,
    level: row.level as LogLevel,
    message: row.message,
    createdAt: row.created_at,
    applicationName: row.application_name,
    tunnelName: row.tunnel_name
  }
}

export class ActivityRepository {
  constructor(private readonly db: Database) {}

  insert(input: {
    applicationId: string | null
    tunnelId: string | null
    level: LogLevel
    message: string
  }): ActivityLog {
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO activity_logs (id, application_id, tunnel_id, level, message, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.applicationId, input.tunnelId, input.level, input.message, createdAt)
    return {
      id,
      applicationId: input.applicationId,
      tunnelId: input.tunnelId,
      level: input.level,
      message: input.message,
      createdAt
    }
  }

  list(query: ActivityQuery = {}): ActivityLog[] {
    const conditions: string[] = []
    const values: Array<string | number> = []
    if (query.applicationId) {
      conditions.push('l.application_id = ?')
      values.push(query.applicationId)
    }
    if (query.tunnelId) {
      conditions.push('l.tunnel_id = ?')
      values.push(query.tunnelId)
    }
    if (query.level) {
      conditions.push('l.level = ?')
      values.push(query.level)
    }
    if (query.search) {
      conditions.push('l.message LIKE ?')
      values.push(`%${query.search}%`)
    }
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 5_000)
    values.push(limit)
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = this.db
      .prepare(
        `SELECT l.*, a.name AS application_name, t.tunnel_name AS tunnel_name
         FROM activity_logs l
         LEFT JOIN applications a ON a.id = l.application_id
         LEFT JOIN tunnels t ON t.id = l.tunnel_id
         ${where}
         ORDER BY l.created_at DESC
         LIMIT ?`
      )
      .all(...values) as unknown as RawActivityRow[]
    return rows.map(toRecord)
  }

  clear(): void {
    this.db.prepare('DELETE FROM activity_logs').run()
  }

  prune(keepRows = 5_000): void {
    this.db
      .prepare(
        `DELETE FROM activity_logs WHERE id NOT IN (
          SELECT id FROM activity_logs ORDER BY created_at DESC LIMIT ?
        )`
      )
      .run(keepRows)
  }
}
