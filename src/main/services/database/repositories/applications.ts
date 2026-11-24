import { randomUUID } from 'node:crypto'
import type { Database } from '../index'
import type { ApplicationRecord } from '../records'
import type { ApplicationType } from '@shared/types'

interface RawApplicationRow {
  id: string
  name: string
  project_name: string
  description: string
  project_directory: string
  working_directory: string
  application_type: string
  start_command: string
  stop_command: string | null
  local_host: string
  local_port: number | null
  environment_variables: string
  auto_start: number
  created_at: string
  updated_at: string
}

function parseEnvironmentVariables(raw: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') result[key] = value
    }
    return result
  } catch {
    return {}
  }
}

function toRecord(row: RawApplicationRow): ApplicationRecord {
  return {
    id: row.id,
    name: row.name,
    projectName: row.project_name ?? '',
    description: row.description,
    projectDirectory: row.project_directory,
    workingDirectory: row.working_directory,
    applicationType: row.application_type as ApplicationType,
    startCommand: row.start_command,
    stopCommand: row.stop_command,
    localHost: row.local_host,
    localPort: row.local_port === null || row.local_port === undefined ? null : Number(row.local_port),
    environmentVariables: parseEnvironmentVariables(row.environment_variables),
    autoStart: Number(row.auto_start) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export type ApplicationCreateInput = Omit<ApplicationRecord, 'id' | 'createdAt' | 'updatedAt'>

export class ApplicationsRepository {
  constructor(private readonly db: Database) {}

  list(): ApplicationRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM applications ORDER BY sort_order ASC, updated_at DESC, name ASC')
      .all() as unknown as RawApplicationRow[]
    return rows.map(toRecord)
  }

  get(id: string): ApplicationRecord | null {
    const row = this.db
      .prepare('SELECT * FROM applications WHERE id = ?')
      .get(id) as unknown as RawApplicationRow | undefined
    return row ? toRecord(row) : null
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM applications').get() as
      | { count: number }
      | undefined
    return Number(row?.count ?? 0)
  }

  create(input: ApplicationCreateInput): ApplicationRecord {
    const id = randomUUID()
    const now = new Date().toISOString()
    const maxRow = this.db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM applications')
      .get() as { maxOrder: number } | undefined
    const nextOrder = Number(maxRow?.maxOrder ?? -1) + 1
    this.db
      .prepare(
        `INSERT INTO applications (
          id, name, project_name, description, project_directory, working_directory, application_type,
          start_command, stop_command, local_host, local_port, environment_variables,
          auto_start, sort_order, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.name,
        input.projectName,
        input.description,
        input.projectDirectory,
        input.workingDirectory,
        input.applicationType,
        input.startCommand,
        input.stopCommand,
        input.localHost,
        input.localPort,
        JSON.stringify(input.environmentVariables),
        input.autoStart ? 1 : 0,
        nextOrder,
        now,
        now
      )
    const created = this.get(id)
    if (!created) throw new Error('Failed to read application after insert')
    return created
  }

  reorder(ids: string[]): void {
    this.db.transaction(() => {
      const stmt = this.db.prepare('UPDATE applications SET sort_order = ? WHERE id = ?')
      ids.forEach((id, index) => {
        stmt.run(index, id)
      })
    })
  }

  update(id: string, input: ApplicationCreateInput): ApplicationRecord | null {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `UPDATE applications SET
          name = ?, project_name = ?, description = ?, project_directory = ?, working_directory = ?,
          application_type = ?, start_command = ?, stop_command = ?, local_host = ?,
          local_port = ?, environment_variables = ?, auto_start = ?, updated_at = ?
        WHERE id = ?`
      )
      .run(
        input.name,
        input.projectName,
        input.description,
        input.projectDirectory,
        input.workingDirectory,
        input.applicationType,
        input.startCommand,
        input.stopCommand,
        input.localHost,
        input.localPort,
        JSON.stringify(input.environmentVariables),
        input.autoStart ? 1 : 0,
        now,
        id
      )
    return this.get(id)
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM applications WHERE id = ?').run(id)
    return Number(result.changes) > 0
  }
}
