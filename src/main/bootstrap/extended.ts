/**
 * Extended Services - Deferred Loading
 *
 * These services are loaded AFTER the window is visible.
 * They use lazy initialization - actual initialization happens on first use.
 *
 * GUIDELINES:
 *   - DEFAULT location for all new features
 *   - Services here do NOT block startup
 *   - Use lazy initialization pattern for heavy modules
 *
 * CURRENT SERVICES:
 *   - Onboarding: First-time user guide (only needed once)
 *   - Remote: Remote access feature (optional)
 *   - Search: Global search (optional)
 *   - Performance: Developer monitoring tools (dev only)
 *   - GitBash: Windows Git Bash setup (Windows optional)
 */

import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { app, BrowserWindow } from 'electron'
import { registerOnboardingHandlers } from '../ipc/onboarding'
import { registerRemoteHandlers } from '../ipc/remote'
import { initializeSearchHandlers, cleanupSearchHandlers } from '../ipc/search'
import { registerPerfHandlers } from '../ipc/perf'
import { registerGitBashHandlers, initializeGitBashOnStartup } from '../ipc/git-bash'
import { registerWorkflowHandlers } from '../ipc/workflow'
import { initSkillAgentWatchers, cleanupSkillAgentWatchers } from '../services/skills-agents-watch.service'

function resolveSuperpowersPatchScriptPath(): string | null {
  const candidatePaths = [
    resolve(process.cwd(), 'scripts', 'apply-superpowers-trigger-patch.mjs'),
    resolve(__dirname, '../../../scripts/apply-superpowers-trigger-patch.mjs'),
    join(app.getAppPath(), 'scripts', 'apply-superpowers-trigger-patch.mjs')
  ]

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

function applySuperpowersTriggerPatchInBackground(): void {
  if (process.env.KITE_SUPERPOWERS_PATCH === '0') {
    console.log('[Bootstrap] Superpowers patch disabled by KITE_SUPERPOWERS_PATCH=0')
    return
  }

  const scriptPath = resolveSuperpowersPatchScriptPath()
  if (!scriptPath) {
    console.log('[Bootstrap] Superpowers patch script not found, skipping.')
    return
  }

  const child = spawn(process.execPath, [scriptPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString().trim()
    if (text.length > 0) {
      console.log(text)
    }
  })
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString().trim()
    if (text.length > 0) {
      console.warn(text)
    }
  })
  child.on('error', (error) => {
    console.warn('[Bootstrap] Failed to start superpowers patch script:', error)
  })
  child.on('close', (code) => {
    if (code !== 0) {
      console.warn(`[Bootstrap] Superpowers patch script exited with code ${code}`)
    }
  })
}

/**
 * Initialize extended services after window is visible
 *
 * @param mainWindow - The main application window
 *
 * These services are loaded asynchronously and do not block the UI.
 * Heavy modules use lazy initialization - they only fully initialize
 * when their features are first accessed.
 */
export function initializeExtendedServices(mainWindow: BrowserWindow): void {
  const start = performance.now()

  // === EXTENDED SERVICES ===
  // These services are loaded after the window is visible.
  // New features should be added here by default.

  // Onboarding: First-time user guide, only needed once
  registerOnboardingHandlers()

  // Remote: Remote access feature, optional functionality
  registerRemoteHandlers(mainWindow)

  // Workflows: Space-level workflow management
  registerWorkflowHandlers(mainWindow)

  // Search: Global search functionality
  initializeSearchHandlers(mainWindow)

  // Performance: Developer monitoring tools
  registerPerfHandlers(mainWindow)

  // GitBash: Windows Git Bash detection and setup
  registerGitBashHandlers(mainWindow)

  // Skills/Agents: Watch for changes and notify renderer
  initSkillAgentWatchers(mainWindow)

  // Non-blocking startup patch: keep superpowers trigger policy narrowed
  applySuperpowersTriggerPatchInBackground()

  // Windows-specific: Initialize Git Bash in background
  if (process.platform === 'win32') {
    initializeGitBashOnStartup()
      .then((status) => {
        console.log('[Bootstrap] Git Bash status:', status)
      })
      .catch((err) => {
        console.error('[Bootstrap] Git Bash initialization failed:', err)
      })
  }

  const duration = performance.now() - start
  console.log(`[Bootstrap] Extended services registered in ${duration.toFixed(1)}ms`)
}

/**
 * Cleanup extended services on app shutdown
 *
 * Called during window-all-closed to properly release resources.
 */
export function cleanupExtendedServices(): void {
  // Search: Cancel any ongoing searches
  cleanupSearchHandlers()

  // Skills/Agents: Cleanup watchers
  cleanupSkillAgentWatchers()

  console.log('[Bootstrap] Extended services cleaned up')
}
