# Local App Manager

**Local App Manager** is a Windows desktop application built with Electron, React, TypeScript, Tailwind CSS, and SQLite for managing local development servers (`localhost`) and optionally exposing them publicly via official **Cloudflare Tunnels** (`cloudflared`) — without manually juggling terminal windows.

## Features

- **Dashboard**: Real-time summary of registered/running applications, active/inactive tunnels, quick actions (*Add Application*, *Start/Stop All Applications*, *Start/Stop All Tunnels*), and recent activity.
- **Application Manager**: Register, edit, duplicate, delete, start, stop, restart, and monitor local projects (Node.js, Next.js, React, Vite, Laravel, PHP, Python, Docker, Custom) with port conflict checks, HTTP health checks, encrypted sensitive environment variables (Windows DPAPI via `safeStorage`), and real-time logs.
- **Cloudflare Tunnel Manager**:
  - **Quick Tunnel** (no Cloudflare account required): spawns `cloudflared tunnel --url ...`, detects the generated `https://<random>.trycloudflare.com` URL in real time, and lets you copy/open/restart/stop independently.
  - **Named Tunnel** (Cloudflare account): authenticates via `cloudflared tunnel login`, lists/creates remote tunnels, routes DNS hostnames, and manages named tunnel lifecycles.
- **Multi-Tunnel Management**: Run multiple tunnels concurrently in isolated child processes with batch actions (*Start Selected*, *Stop Selected*, *Restart Selected*, *Start All*, *Stop All* with confirmation).
- **Start & Expose Workflow**: One-click workflow that validates config → checks port → starts the local app → verifies HTTP health → starts the tunnel → detects & persists the public URL → notifies you. Aborts tunnel creation if the app fails; keeps the local app running if the tunnel fails.
- **Process & Log Manager**: Isolated child processes with Windows process-tree termination (`taskkill /T /F`) to prevent orphan processes, plus separated real-time **Application**, **Tunnel**, and **System** logs with search, level filter, auto-scroll, copy, clear, and export.
- **Cloudflared Binary Management**: Detects existing `cloudflared` installations, downloads the official binary from Cloudflare's GitHub Releases with progress tracking, checks for updates, and supports custom binary paths.
- **Settings & System Tray**: Launch on Windows startup, minimize to tray, launch minimized, Dark/Light/System theme, timeouts, log retention, and tray quick controls.

## Architecture & Security

- **Electron Security**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict Content Security Policy in production, and Zod-validated IPC channels via [`src/preload/index.ts`](src/preload/index.ts).
- **Modular Structure**:
  - `src/main/`: Electron main process, tray, window management, IPC handlers, SQLite database (`node:sqlite`), repositories, and isolated services (`application-manager`, `tunnel-manager`, `process-manager`, `cloudflared-manager`, `health-check`, `log-manager`, `secure-store`, `settings`, `workflow`).
  - `src/preload/`: Typed `window.api` bridge.
  - `src/renderer/`: React 19 + Tailwind CSS v4 + Radix UI + Zustand renderer.
  - `src/shared/`: Shared domain types, constants, errors, and Zod validation schemas.
- **Secret Protection**: Sensitive environment variables (matching keys like `SECRET`, `TOKEN`, `KEY`, `PASSWORD`, etc.) are encrypted with Windows DPAPI (`electron.safeStorage`) before saving to SQLite and masked in UI responses.
- **Explicit Public Exposure**: Tunnels are never started automatically; first-time exposure requires explicit user confirmation.

## Prerequisites

- **OS**: Windows 10 or Windows 11 (x64)
- **Node.js**: v22.5+ (uses built-in `node:sqlite`)
- **npm**: v10+

## Installation & Development

```bash
# Install dependencies
npm install

# Run in development mode (Electron + Vite HMR)
npm run dev

# Type-check main, preload, and renderer
npm run typecheck

# Run automated tests (Vitest)
npm test

# Build production bundles (out/)
npm run build
```

## Packaging Windows Installer & Portable Executable

```bash
# Build both NSIS installer (.exe) and Portable executable (.exe) into release/
npm run dist

# Or build unpacked directory only (faster verification)
npm run dist:dir
```

Build outputs in `release/`:
- `Local-App-Manager-Setup-1.0.0.exe` — Windows NSIS installer (supports automatic in-app updates via GitHub Releases)
- `Local-App-Manager-Portable-1.0.0.exe` — Portable standalone Windows executable

## Auto-Update & Publishing Releases (GitHub)

This repository (`angkrnia/local-app-manager`) is configured with **`electron-updater`** and a GitHub Actions workflow ([`.github/workflows/release.yml`](.github/workflows/release.yml)):

1. Bump `"version"` in `package.json` (for example `1.0.0` → `1.0.1`).
2. Commit and push a matching version tag:
   ```bash
   git tag v1.0.1
   git push origin main --tags
   ```
3. GitHub Actions automatically runs tests, builds the Windows NSIS installer + Portable executable + `latest.yml`, and publishes them to **GitHub Releases**.
4. Users can check, download, and install new versions directly from **Settings → About & Paths → Application Updates**.

## Usage Quick Start

1. Launch **Local App Manager**.
2. If `cloudflared` is not detected, click **Download cloudflared** in the top banner or open **Settings → cloudflared Binary**.
3. Go to **Applications → Add Application**, select your project directory, enter the start command (e.g. `npm run dev`) and local port (e.g. `3000`).
4. Click **Start & Expose** on the application to start the local server, verify health, launch a Cloudflare Quick Tunnel, and get a shareable public URL.
5. Click **Stop Everything** when finished to safely close the tunnel and stop the local process tree.
