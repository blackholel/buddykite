/**
 * Agents IPC Handlers
 *
 * Handles IPC communication for agents management between renderer and main process.
 */

import { ipcMain, shell } from 'electron'
import {
  listAgents,
  getAgentContent,
  clearAgentsCache,
  createAgent,
  createAgentInLibrary,
  updateAgent,
  updateAgentInLibrary,
  deleteAgent,
  deleteAgentFromLibrary,
  setAgentEnabledState,
  copyAgentToSpaceByRef
} from '../services/agents.service'
import type { ResourceRef } from '../services/resource-ref.service'
import { isResourceListView } from '../../shared/resource-access'
import { getKiteAgentsDir } from '../services/kite-library.service'
import { getLockedUserConfigRootDir } from '../services/config-source-mode.service'
import { importAgentFile } from '../services/resource-library-import.service'
import { generateAgentDraft } from '../services/resource-draft-generator.service'

export function registerAgentsHandlers(): void {
  // List all available agents
  ipcMain.handle('agents:list', async (_event, workDir?: string, locale?: string, view?: string) => {
    try {
      if (!isResourceListView(view)) {
        return { success: false, error: 'view is required and must be a valid ResourceListView' }
      }
      const agents = listAgents(workDir, view, locale)
      return { success: true, data: agents }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Get agent content by name
  ipcMain.handle('agents:get-content', async (_event, name: string, workDir?: string) => {
    try {
      const content = getAgentContent(name, workDir)
      if (!content) {
        return { success: false, error: `Agent not found: ${name}` }
      }
      return { success: true, data: content }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Clear agents cache
  ipcMain.handle('agents:clear-cache', async () => {
    try {
      clearAgentsCache()
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Create a new agent in space directory
  ipcMain.handle('agents:create', async (_event, workDir: string, name: string, content: string) => {
    try {
      const agent = createAgent(workDir, name, content)
      return { success: true, data: agent }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('agents:create-library', async (_event, name: string, content: string) => {
    try {
      const agent = createAgentInLibrary(name, content)
      return { success: true, data: agent }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('agents:generate-draft', async (_event, description: string) => {
    try {
      const draft = generateAgentDraft(description)
      return { success: true, data: draft }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Update an existing agent
  ipcMain.handle('agents:update', async (_event, agentPath: string, content: string) => {
    try {
      const result = updateAgent(agentPath, content)
      if (!result) {
        return { success: false, error: 'Failed to update agent' }
      }
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('agents:update-library', async (_event, agentPath: string, content: string) => {
    try {
      const result = updateAgentInLibrary(agentPath, content)
      if (!result) {
        return { success: false, error: 'Failed to update library agent' }
      }
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Delete an agent
  ipcMain.handle('agents:delete', async (_event, agentPath: string) => {
    try {
      const result = deleteAgent(agentPath)
      if (!result) {
        return { success: false, error: 'Failed to delete agent' }
      }
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('agents:delete-library', async (_event, agentPath: string) => {
    try {
      const result = deleteAgentFromLibrary(agentPath)
      if (!result) {
        return { success: false, error: 'Failed to delete library agent' }
      }
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(
    'agents:set-enabled',
    async (_event, payload: { source: 'app' | 'global' | 'space' | 'plugin'; name: string; namespace?: string; enabled: boolean }) => {
      try {
        const result = setAgentEnabledState(
          {
            source: payload.source,
            name: payload.name,
            namespace: payload.namespace
          },
          payload.enabled
        )
        if (!result) {
          return { success: false, error: 'Failed to update agent enabled state' }
        }
        return { success: true, data: true }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  ipcMain.handle('agents:open-library-folder', async () => {
    try {
      const libraryPath = getKiteAgentsDir(getLockedUserConfigRootDir())
      const error = await shell.openPath(libraryPath)
      if (error) return { success: false, error }
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(
    'agents:import-from-path',
    async (_event, sourcePath: string, options?: { overwrite?: boolean }) => {
      try {
        const result = importAgentFile(sourcePath, options)
        if (result.status === 'imported') {
          clearAgentsCache()
        }
        return { success: true, data: result }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  ipcMain.handle('agents:show-item-in-folder', async (_event, agentPath: string) => {
    try {
      shell.showItemInFolder(agentPath)
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(
    'agents:copy-to-space-by-ref',
    async (_event, ref: ResourceRef, workDir: string, options?: { overwrite?: boolean }) => {
      try {
        return { success: true, data: copyAgentToSpaceByRef(ref, workDir, options) }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )
}
