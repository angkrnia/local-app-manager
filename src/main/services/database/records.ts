import type {
  ActivityLog,
  ApplicationType,
  LogLevel,
  ProcessSession,
  TunnelStatus,
  TunnelType
} from '@shared/types'

export interface ApplicationRecord {
  id: string
  name: string
  projectName: string
  description: string
  projectDirectory: string
  workingDirectory: string
  applicationType: ApplicationType
  startCommand: string
  stopCommand: string | null
  localHost: string
  localPort: number
  environmentVariables: Record<string, string>
  autoStart: boolean
  createdAt: string
  updatedAt: string
}

export interface TunnelRecord {
  id: string
  applicationId: string | null
  applicationName: string | null
  tunnelType: TunnelType
  tunnelName: string | null
  cloudflareTunnelId: string | null
  hostname: string | null
  localUrl: string
  publicUrl: string | null
  status: TunnelStatus
  cloudflaredPid: number | null
  startedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface ProcessSessionRecord extends ProcessSession {}

export type { ActivityLog, LogLevel }
