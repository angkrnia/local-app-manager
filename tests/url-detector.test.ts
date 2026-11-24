import { describe, expect, it } from 'vitest'
import {
  TunnelUrlDetector,
  extractQuickTunnelUrl,
  isNamedTunnelConnected,
  isNewerVersion,
  parseCloudflaredVersion
} from '../src/main/services/tunnel-manager/url-detector'
import {
  LogPortDetector,
  extractPortsFromText
} from '../src/main/services/application-manager/port-detector'
import {
  applicationInputSchema,
  externalUrlSchema,
  namedTunnelInputSchema,
  portSchema
} from '@shared/validation'

describe('Cloudflared URL & version detection', () => {
  it('extracts a trycloudflare.com URL from cloudflared banner output', () => {
    const sample = `
2026-11-20T08:00:00Z INF +--------------------------------------------------------------------------------------------+
2026-11-20T08:00:00Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2026-11-20T08:00:00Z INF |  https://bright-forest-4821.trycloudflare.com                                              |
2026-11-20T08:00:00Z INF +--------------------------------------------------------------------------------------------+
`
    expect(extractQuickTunnelUrl(sample)).toBe('https://bright-forest-4821.trycloudflare.com')
  })

  it('strips ANSI color escape sequences before detecting the URL', () => {
    const colored = '\u001b[32mhttps://Ansi-Colored-123.trycloudflare.com\u001b[0m'
    expect(extractQuickTunnelUrl(colored)).toBe('https://ansi-colored-123.trycloudflare.com')
  })

  it('detects URLs split across streamed chunks and emits once', () => {
    const detector = new TunnelUrlDetector()
    expect(detector.push('2026-11-20 INF | https://split-')).toBeNull()
    expect(detector.push('chunk-url.trycloudflare.com |')).toBe(
      'https://split-chunk-url.trycloudflare.com'
    )
    // Subsequent identical URL should not re-trigger
    expect(detector.push('https://split-chunk-url.trycloudflare.com')).toBeNull()
    expect(detector.detectedUrl).toBe('https://split-chunk-url.trycloudflare.com')
  })

  it('detects named tunnel registration lines', () => {
    expect(
      isNamedTunnelConnected(
        '2026-11-20T08:00:01Z INF Registered tunnel connection connIndex=0 connection=12345678-abcd-ef01-2345-6789abcdef01'
      )
    ).toBe(true)
    expect(isNamedTunnelConnected('Starting tunnel...')).toBe(false)
  })

  it('parses cloudflared versions and compares semver/calver releases', () => {
    expect(parseCloudflaredVersion('cloudflared version 2026.2.1 (built 2026-02-10)')).toBe('2026.2.1')
    expect(isNewerVersion('2026.3.0', '2026.2.1')).toBe(true)
    expect(isNewerVersion('2026.2.1', '2026.2.1')).toBe(false)
    expect(isNewerVersion('2025.11.0', '2026.2.1')).toBe(false)
  })
})

describe('Shared validation & security schemas', () => {
  it('validates port range 1-65535 strictly', () => {
    expect(portSchema.safeParse(3000).success).toBe(true)
    expect(portSchema.safeParse(1).success).toBe(true)
    expect(portSchema.safeParse(65535).success).toBe(true)
    expect(portSchema.safeParse(0).success).toBe(false)
    expect(portSchema.safeParse(65536).success).toBe(false)
    expect(portSchema.safeParse(3000.5).success).toBe(false)
  })

  it('rejects multiline commands and invalid env keys', () => {
    const result = applicationInputSchema.safeParse({
      name: 'API',
      description: '',
      projectDirectory: 'C:\\projects\\api',
      workingDirectory: '',
      applicationType: 'node',
      startCommand: 'npm run dev\nrm -rf /',
      stopCommand: null,
      localHost: '127.0.0.1',
      localPort: 3000,
      environmentVariables: {},
      autoStart: false
    })
    expect(result.success).toBe(false)
  })

  it('blocks non-http(s) external URLs and trycloudflare hostnames on named tunnels', () => {
    expect(externalUrlSchema.safeParse('https://example.com').success).toBe(true)
    expect(externalUrlSchema.safeParse('file:///C:/Windows/System32/cmd.exe').success).toBe(false)
    expect(externalUrlSchema.safeParse('javascript:alert(1)').success).toBe(false)

    const named = namedTunnelInputSchema.safeParse({
      applicationId: '11111111-1111-4111-8111-111111111111',
      tunnelName: 'my-tunnel',
      hostname: 'demo.trycloudflare.com'
    })
    expect(named.success).toBe(false)
  })

  it('accepts null localPort for auto-detect and rejects invalid ports', () => {
    const base = {
      name: 'Auto Port App',
      description: '',
      projectDirectory: 'C:\\projects\\api',
      workingDirectory: '',
      applicationType: 'node' as const,
      startCommand: 'npm run dev',
      stopCommand: null,
      localHost: '127.0.0.1',
      environmentVariables: {},
      autoStart: false
    }

    const autoParsed = applicationInputSchema.safeParse({ ...base, localPort: null })
    expect(autoParsed.success).toBe(true)
    if (autoParsed.success) expect(autoParsed.data.localPort).toBeNull()

    expect(applicationInputSchema.safeParse({ ...base, localPort: 0 }).success).toBe(false)
    expect(applicationInputSchema.safeParse({ ...base, localPort: 70_000 }).success).toBe(false)
  })
})

describe('Runtime log port extraction', () => {
  it('extracts ports from local URLs, structured PORT output, and listen banners', () => {
    expect(extractPortsFromText('\u001b[32mLocal: http://localhost:5173/\u001b[0m')).toEqual([5173])
    expect(extractPortsFromText("  PORT: '7008',")).toEqual([7008])
    expect(extractPortsFromText('{"PORT": 4100, "env": "dev"}')).toEqual([4100])
    expect(extractPortsFromText('PORT=3001')).toEqual([3001])
    expect(extractPortsFromText('Server listening on port 8080')).toEqual([8080])
    expect(extractPortsFromText('Server running at 127.0.0.1:4000')).toEqual([4000])
  })

  it('ignores timestamps, dates, out-of-range numbers, and deduplicates across pushes', () => {
    expect(extractPortsFromText('11/24/2026, 1:29:15 PM starting server')).toEqual([])
    expect(extractPortsFromText('listening on port 70000 and port 0')).toEqual([])

    const detector = new LogPortDetector()
    detector.addCandidate(7008)
    expect(detector.push('http://127.0.0.1:7008')).toEqual([])
    expect(detector.push('also listening on port 8080 and http://localhost:8080')).toEqual([8080])
    expect(detector.getCandidates()).toEqual([7008, 8080])
  })
})
