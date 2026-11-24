import { mkdirSync, existsSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface AppPaths {
  userData: string
  database: string
  logs: string
  cloudflaredDir: string
  managedCloudflared: string
  cloudflaredHome: string
}

export function createAppPaths(userData: string): AppPaths {
  const cloudflaredHome = join(userData, 'cloudflared-home')
  return {
    userData,
    database: join(userData, 'data', 'tunnel-manager.db'),
    logs: join(userData, 'logs'),
    cloudflaredDir: join(userData, 'bin'),
    managedCloudflared: join(userData, 'bin', 'cloudflared.exe'),
    cloudflaredHome
  }
}

export function ensureDirectory(directory: string): string {
  mkdirSync(directory, { recursive: true })
  return directory
}

export function pathExists(target: string): boolean {
  try {
    return existsSync(target)
  } catch {
    return false
  }
}

export function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory()
  } catch {
    return false
  }
}

export function isFile(target: string): boolean {
  try {
    return statSync(target).isFile()
  } catch {
    return false
  }
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T
  } catch {
    return fallback
  }
}
