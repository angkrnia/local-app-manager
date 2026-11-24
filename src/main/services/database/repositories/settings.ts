import type { Database } from '../index'

export class SettingsRepository {
  constructor(private readonly db: Database) {}

  getAll(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as unknown as Array<{
      key: string
      value: string
    }>
    const result: Record<string, string> = {}
    for (const row of rows) result[row.key] = row.value
    return result
  }

  setMany(values: Record<string, unknown>): void {
    const now = new Date().toISOString()
    const statement = this.db.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(values)) {
        statement.run(key, JSON.stringify(value), now)
      }
    })
  }
}
