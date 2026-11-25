import { z } from 'zod'
import { LIMITS, TRYCLOUDFLARE_SUFFIX } from './constants'

const noControlCharacters = (value: string): boolean => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)

const commandSchema = z
  .string()
  .trim()
  .min(1, 'Command is required')
  .max(LIMITS.command, `Command must be at most ${LIMITS.command} characters`)
  .refine((value) => !/[\r\n\u0000]/.test(value), 'Command cannot contain line breaks')
  .refine(noControlCharacters, 'Command contains invalid control characters')

const optionalCommandSchema = z
  .union([commandSchema, z.literal(''), z.null()])
  .transform((value) => (value === '' || value === null ? null : value))

const pathSchema = z
  .string()
  .trim()
  .min(1, 'Path is required')
  .max(LIMITS.path, `Path must be at most ${LIMITS.path} characters`)
  .refine((value) => !value.includes('\u0000'), 'Path contains invalid characters')

const hostSchema = z
  .string()
  .trim()
  .min(1, 'Host is required')
  .max(255)
  .regex(/^[A-Za-z0-9._\-[\]]+$/, 'Host must be a hostname or IP address without a scheme or port')

export const portSchema = z
  .number()
  .int('Port must be a whole number')
  .min(1, 'Port must be between 1 and 65535')
  .max(65_535, 'Port must be between 1 and 65535')

export const optionalPortSchema = portSchema.nullable().default(null)

export const idSchema = z.string().uuid('Invalid identifier')

const environmentVariablesSchema = z
  .record(
    z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Environment variable names must be valid identifiers'),
    z
      .string()
      .max(LIMITS.environmentValue, `Environment variable value must be at most ${LIMITS.environmentValue} characters`)
      .refine((value) => !value.includes('\u0000'), 'Environment variable value contains invalid characters')
  )
  .refine(
    (record) => Object.keys(record).length <= LIMITS.environmentVariables,
    `At most ${LIMITS.environmentVariables} environment variables are allowed`
  )

export const applicationTypeSchema = z.enum([
  'node',
  'nextjs',
  'nuxt',
  'vite',
  'react',
  'laravel',
  'php',
  'python',
  'docker',
  'custom'
])

export const applicationInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Application name is required')
      .max(LIMITS.applicationName, `Application name must be at most ${LIMITS.applicationName} characters`)
      .refine(noControlCharacters, 'Application name contains invalid control characters'),
    projectName: z
      .string()
      .trim()
      .max(LIMITS.applicationName, `Project name must be at most ${LIMITS.applicationName} characters`)
      .refine(noControlCharacters, 'Project name contains invalid control characters')
      .default(''),
    description: z
      .string()
      .trim()
      .max(LIMITS.description, `Description must be at most ${LIMITS.description} characters`)
      .default(''),
    projectDirectory: pathSchema,
    workingDirectory: z
      .string()
      .trim()
      .max(LIMITS.path, `Path must be at most ${LIMITS.path} characters`)
      .default(''),
    applicationType: applicationTypeSchema,
    startCommand: commandSchema,
    stopCommand: optionalCommandSchema,
    localHost: hostSchema.default('127.0.0.1'),
    localPort: optionalPortSchema,
    environmentVariables: environmentVariablesSchema.default({}),
    autoStart: z.boolean().default(false)
  })
  .strict()

export const quickTunnelInputSchema = z
  .object({
    applicationId: idSchema,
    name: z.string().trim().max(LIMITS.tunnelName).optional(),
    startNow: z.boolean().optional()
  })
  .strict()

const tunnelNameSchema = z
  .string()
  .trim()
  .min(1, 'Tunnel name is required')
  .max(LIMITS.tunnelName)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Tunnel name must contain lowercase letters, numbers and hyphens only, and cannot start or end with a hyphen'
  )

const hostnameSchema = z
  .string()
  .trim()
  .min(4, 'Hostname is required')
  .max(LIMITS.hostname)
  .regex(
    /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i,
    'Enter a valid fully qualified domain name, for example app.example.com'
  )
  .refine(
    (value) => !value.toLowerCase().endsWith(TRYCLOUDFLARE_SUFFIX),
    'trycloudflare.com hostnames are reserved for Quick Tunnels'
  )

export const namedTunnelInputSchema = z
  .object({
    applicationId: idSchema,
    tunnelName: tunnelNameSchema,
    hostname: hostnameSchema,
    startNow: z.boolean().optional()
  })
  .strict()

export const namedTunnelCreateRemoteSchema = z.object({ name: tunnelNameSchema }).strict()

export const routeDnsSchema = z.object({ tunnelName: tunnelNameSchema, hostname: hostnameSchema }).strict()

export const tunnelRemoveOptionsSchema = z
  .object({
    deleteRemote: z.boolean().optional().default(false)
  })
  .strict()
  .optional()
  .default({ deleteRemote: false })

export const portCheckSchema = z.object({ host: hostSchema, port: portSchema }).strict()

export const logQuerySchema = z
  .object({
    source: z.enum(['application', 'tunnel', 'system']).optional(),
    applicationId: idSchema.optional(),
    tunnelId: idSchema.optional(),
    level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    search: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(LIMITS.maxLogsPerQuery).optional()
  })
  .strict()

export const logClearSchema = z
  .object({
    source: z.enum(['application', 'tunnel', 'system']).optional(),
    applicationId: idSchema.optional(),
    tunnelId: idSchema.optional()
  })
  .strict()

export const exportLogsSchema = z
  .object({
    source: z.enum(['application', 'tunnel', 'system']),
    applicationId: idSchema.optional(),
    tunnelId: idSchema.optional(),
    suggestedName: z.string().max(120).optional()
  })
  .strict()

export const activityQuerySchema = z
  .object({
    applicationId: idSchema.optional(),
    tunnelId: idSchema.optional(),
    level: z.enum(['debug', 'info', 'warn', 'error']).optional(),
    search: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(LIMITS.maxLogsPerQuery).optional()
  })
  .strict()

export const settingsPatchSchema = z
  .object({
    launchOnStartup: z.boolean().optional(),
    minimizeToTray: z.boolean().optional(),
    destroyWindowOnHide: z.boolean().optional(),
    launchMinimized: z.boolean().optional(),
    theme: z.enum(['dark', 'light', 'system']).optional(),
    defaultWorkingDirectory: z.string().trim().max(LIMITS.path).optional(),
    defaultTunnelType: z.enum(['quick', 'named']).optional(),
    cloudflaredPath: z.string().trim().max(LIMITS.path).optional(),
    defaultProtocol: z.enum(['http', 'https']).optional(),
    tunnelStartupTimeoutMs: z.number().int().min(15_000).max(600_000).optional(),
    appStartupTimeoutMs: z.number().int().min(10_000).max(600_000).optional(),
    healthCheckIntervalMs: z.number().int().min(5_000).max(300_000).optional(),
    processTerminationTimeoutMs: z.number().int().min(1_000).max(60_000).optional(),
    maxLogEntries: z.number().int().min(100).max(50_000).optional(),
    logDirectory: z.string().trim().max(LIMITS.path).optional(),
    autoCleanupLogs: z.boolean().optional(),
    logRetentionDays: z.number().int().min(1).max(365).optional(),
    hasAcceptedPublicWarning: z.boolean().optional()
  })
  .strict()

export const externalUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2_048)
  .refine((value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'http:' || url.protocol === 'https:'
    } catch {
      return false
    }
  }, 'Only http and https URLs can be opened')

export const openPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.path)
  .refine((value) => !value.includes('\u0000'), 'Invalid path')

export const batchIdsSchema = z
  .array(idSchema)
  .min(1, 'Select at least one item')
  .max(LIMITS.maxBatchSize)

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const field = issue.path.map(String).join('.')
      return field ? `${field}: ${issue.message}` : issue.message
    })
    .join('; ')
}

export type ApplicationInputParsed = z.infer<typeof applicationInputSchema>
