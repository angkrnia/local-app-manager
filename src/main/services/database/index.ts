import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS applications (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_applications_name ON applications (name);
CREATE INDEX IF NOT EXISTS idx_applications_port ON applications (local_port);
CREATE INDEX IF NOT EXISTS idx_applications_updated ON applications (updated_at DESC);

CREATE TABLE IF NOT EXISTS tunnels (
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

CREATE INDEX IF NOT EXISTS idx_tunnels_application ON tunnels (application_id);
CREATE INDEX IF NOT EXISTS idx_tunnels_status ON tunnels (status);
CREATE INDEX IF NOT EXISTS idx_tunnels_created ON tunnels (created_at DESC);

CREATE TABLE IF NOT EXISTS process_sessions (
  id TEXT PRIMARY KEY,
  application_id TEXT REFERENCES applications (id) ON DELETE SET NULL,
  tunnel_id TEXT REFERENCES tunnels (id) ON DELETE SET NULL,
  process_type TEXT NOT NULL CHECK (process_type IN ('application', 'tunnel')),
  pid INTEGER,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  stopped_at TEXT,
  exit_code INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sessions_application ON process_sessions (application_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tunnel ON process_sessions (tunnel_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON process_sessions (started_at DESC);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  application_id TEXT REFERENCES applications (id) ON DELETE SET NULL,
  tunnel_id TEXT REFERENCES tunnels (id) ON DELETE SET NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_application ON activity_logs (application_id);
CREATE INDEX IF NOT EXISTS idx_activity_tunnel ON activity_logs (tunnel_id);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

export class Database {
  readonly raw: DatabaseSync
  readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
    if (filePath !== ':memory:') {
      mkdirSync(dirname(filePath), { recursive: true })
    }
    this.raw = new DatabaseSync(filePath)
    this.raw.exec('PRAGMA journal_mode = WAL;')
    // WAL + NORMAL avoids an fsync on every commit; a crash may lose the last
    // transactions but never corrupts the database.
    this.raw.exec('PRAGMA synchronous = NORMAL;')
    this.raw.exec('PRAGMA foreign_keys = ON;')
    this.raw.exec('PRAGMA busy_timeout = 5000;')
    this.raw.exec('PRAGMA cache_size = -8000;')
    this.migrate()
  }

  private migrate(): void {
    const row = this.raw.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
    const version = Number(row?.user_version ?? 0)
    if (version < 1) {
      this.raw.exec('BEGIN')
      try {
        this.raw.exec(SCHEMA_V1)
        this.raw.exec('PRAGMA user_version = 1')
        this.raw.exec('COMMIT')
      } catch (error) {
        this.raw.exec('ROLLBACK')
        throw error
      }
    }
    if (version < 2) {
      this.raw.exec('BEGIN')
      try {
        const columns = this.raw
          .prepare('PRAGMA table_info(applications)')
          .all() as Array<{ name: string }>
        if (!columns.some((col) => col.name === 'sort_order')) {
          this.raw.exec('ALTER TABLE applications ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0')
          const existing = this.raw
            .prepare('SELECT id FROM applications ORDER BY updated_at DESC, name ASC')
            .all() as Array<{ id: string }>
          const updateStmt = this.raw.prepare('UPDATE applications SET sort_order = ? WHERE id = ?')
          existing.forEach((item, index) => {
            updateStmt.run(index, item.id)
          })
        }
        this.raw.exec('CREATE INDEX IF NOT EXISTS idx_applications_sort_order ON applications (sort_order ASC)')
        this.raw.exec('PRAGMA user_version = 2')
        this.raw.exec('COMMIT')
      } catch (error) {
        this.raw.exec('ROLLBACK')
        throw error
      }
    }
    if (version < 3) {
      this.raw.exec('BEGIN')
      try {
        const columns = this.raw
          .prepare('PRAGMA table_info(applications)')
          .all() as Array<{ name: string }>
        if (!columns.some((col) => col.name === 'project_name')) {
          this.raw.exec("ALTER TABLE applications ADD COLUMN project_name TEXT NOT NULL DEFAULT ''")
        }
        this.raw.exec('CREATE INDEX IF NOT EXISTS idx_applications_project_name ON applications (project_name)')
        this.raw.exec('PRAGMA user_version = 3')
        this.raw.exec('COMMIT')
      } catch (error) {
        this.raw.exec('ROLLBACK')
        throw error
      }
    }
    if (version < 4) {
      this.raw.exec('PRAGMA foreign_keys = OFF')
      try {
        this.raw.exec('BEGIN')
        try {
          this.raw.exec(`
            CREATE TABLE applications_new (
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
              local_port INTEGER CHECK (local_port IS NULL OR local_port BETWEEN 1 AND 65535),
              environment_variables TEXT NOT NULL DEFAULT '{}',
              auto_start INTEGER NOT NULL DEFAULT 0,
              sort_order INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            INSERT INTO applications_new (
              id, name, project_name, description, project_directory, working_directory,
              application_type, start_command, stop_command, local_host, local_port,
              environment_variables, auto_start, sort_order, created_at, updated_at
            )
            SELECT
              id, name, project_name, description, project_directory, working_directory,
              application_type, start_command, stop_command, local_host, local_port,
              environment_variables, auto_start, sort_order, created_at, updated_at
            FROM applications;

            DROP TABLE applications;
            ALTER TABLE applications_new RENAME TO applications;

            CREATE INDEX IF NOT EXISTS idx_applications_name ON applications (name);
            CREATE INDEX IF NOT EXISTS idx_applications_port ON applications (local_port);
            CREATE INDEX IF NOT EXISTS idx_applications_updated ON applications (updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_applications_sort_order ON applications (sort_order ASC);
            CREATE INDEX IF NOT EXISTS idx_applications_project_name ON applications (project_name);

            PRAGMA user_version = 4;
          `)
          this.raw.exec('COMMIT')
        } catch (error) {
          this.raw.exec('ROLLBACK')
          throw error
        }
      } finally {
        this.raw.exec('PRAGMA foreign_keys = ON')
      }
    }
  }

  prepare(sql: string): ReturnType<DatabaseSync['prepare']> {
    return this.raw.prepare(sql)
  }

  transaction<T>(work: () => T): T {
    this.raw.exec('BEGIN')
    try {
      const result = work()
      this.raw.exec('COMMIT')
      return result
    } catch (error) {
      this.raw.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    try {
      this.raw.close()
    } catch {
      // Ignore double close during shutdown.
    }
  }
}
