/**
 * Skills IPC Handlers
 *
 * Handles IPC communication for skills management between renderer and main process.
 */

import { ipcMain, shell } from 'electron'
import { join } from 'path'
import {
  listSkills,
  getSkillContent,
  createSkill,
  createSkillInLibrary,
  updateSkill,
  updateSkillInLibrary,
  deleteSkill,
  deleteSkillFromLibrary,
  setSkillEnabledState,
  saveSopSkill,
  copySkillToSpaceByRef,
  clearSkillsCache,
  invalidateSkillsCache
} from '../services/skills.service'
import { clearAgentsCache, invalidateAgentsCache } from '../services/agents.service'
import { clearPluginsCache } from '../services/plugins.service'
import { importSkillDirectory } from '../services/resource-library-import.service'
import { generateSkillDraft } from '../services/resource-draft-generator.service'
import type { ResourceRef } from '../services/resource-ref.service'
import { isResourceListView } from '../../shared/resource-access'
import {
  getResourceIndexSnapshot,
  rebuildAllResourceIndexes,
  rebuildResourceIndex
} from '../services/resource-index.service'
import { getKiteSkillsDir } from '../services/kite-library.service'
import { getLockedUserConfigRootDir } from '../services/config-source-mode.service'

export function registerSkillsHandlers(): void {
  // List all available skills
  ipcMain.handle('skills:list', async (_event, workDir?: string, locale?: string, view?: string) => {
    try {
      if (!isResourceListView(view)) {
        return { success: false, error: 'view is required and must be a valid ResourceListView' }
      }
      const skills = listSkills(workDir, view, locale)
      return { success: true, data: skills }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Get skill content by name
  ipcMain.handle('skills:get-content', async (_event, name: string, workDir?: string) => {
    try {
      const content = getSkillContent(name, workDir)
      if (!content) {
        return { success: false, error: `Skill not found: ${name}` }
      }
      return { success: true, data: content }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Create a new skill in space directory
  ipcMain.handle('skills:create', async (_event, workDir: string, name: string, content: string) => {
    try {
      const skill = createSkill(workDir, name, content)
      return { success: true, data: skill }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('skills:create-library', async (_event, name: string, content: string) => {
    try {
      const skill = createSkillInLibrary(name, content)
      return { success: true, data: skill }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('skills:generate-draft', async (_event, description: string) => {
    try {
      const draft = generateSkillDraft(description)
      return { success: true, data: draft }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Update an existing skill
  ipcMain.handle('skills:update', async (_event, skillPath: string, content: string) => {
    try {
      const result = updateSkill(skillPath, content)
      if (!result) {
        return { success: false, error: 'Failed to update skill' }
      }
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('skills:update-library', async (_event, skillPath: string, content: string) => {
    try {
      const result = updateSkillInLibrary(skillPath, content)
      if (!result) {
        return { success: false, error: 'Failed to update library skill' }
      }
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Save SOP recording into a skill (create or update)
  ipcMain.handle(
    'skills:save-sop-recording',
    async (
      _event,
      payload: {
        workDir: string
        skillName: string
        description?: string
        sopSpec: {
          version: string
          name: string
          steps: Array<Record<string, unknown>>
          meta?: Record<string, unknown>
        }
      }
    ) => {
      try {
        const result = saveSopSkill(payload as Parameters<typeof saveSopSkill>[0])
        return { success: true, data: result }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  // Delete a skill
  ipcMain.handle('skills:delete', async (_event, skillPath: string) => {
    try {
      const result = deleteSkill(skillPath)
      if (!result) {
        return { success: false, error: 'Failed to delete skill' }
      }
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('skills:delete-library', async (_event, skillPath: string) => {
    try {
      const targetSkill = listSkills(undefined, 'taxonomy-admin').find((item) => item.path === skillPath)
      if (targetSkill && (targetSkill.source === 'plugin' || targetSkill.source === 'installed')) {
        return {
          success: false,
          error: 'Plugin resources cannot be deleted from library',
          errorCode: 'PLUGIN_RESOURCE_DELETE_FORBIDDEN'
        }
      }

      const result = deleteSkillFromLibrary(skillPath)
      if (!result) {
        return { success: false, error: 'Failed to delete library skill' }
      }
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(
    'skills:set-enabled',
    async (_event, payload: { source: 'app' | 'global' | 'space' | 'installed'; name: string; namespace?: string; enabled: boolean }) => {
      try {
        const result = setSkillEnabledState(
          {
            source: payload.source,
            name: payload.name,
            namespace: payload.namespace
          },
          payload.enabled
        )
        if (!result) {
          return { success: false, error: 'Failed to update skill enabled state' }
        }
        return { success: true, data: true }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  ipcMain.handle('skills:open-library-folder', async () => {
    try {
      const libraryPath = getKiteSkillsDir(getLockedUserConfigRootDir())
      const error = await shell.openPath(libraryPath)
      if (error) return { success: false, error }
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(
    'skills:import-from-path',
    async (_event, sourcePath: string, options?: { overwrite?: boolean }) => {
      try {
        const result = importSkillDirectory(sourcePath, options)
        if (result.status === 'imported') {
          clearSkillsCache()
        }
        return { success: true, data: result }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  ipcMain.handle('skills:show-item-in-folder', async (_event, skillPath: string) => {
    try {
      const targetPath = skillPath.endsWith('SKILL.md')
        ? skillPath
        : join(skillPath, 'SKILL.md')
      shell.showItemInFolder(targetPath)
      return { success: true, data: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle(
    'skills:copy-to-space-by-ref',
    async (_event, ref: ResourceRef, workDir: string, options?: { overwrite?: boolean }) => {
      try {
        return { success: true, data: copySkillToSpaceByRef(ref, workDir, options) }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  // Clear skills cache (useful after external modifications)
  ipcMain.handle('skills:clear-cache', async () => {
    try {
      clearSkillsCache()
      return { success: true }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('skills:refresh', async (_event, workDir?: string) => {
    try {
      if (workDir) {
        invalidateSkillsCache(workDir)
        invalidateAgentsCache(workDir)
        return { success: true, data: rebuildResourceIndex(workDir, 'manual-refresh') }
      }

      clearPluginsCache()
      clearSkillsCache()
      clearAgentsCache()
      rebuildAllResourceIndexes('manual-refresh')
      return { success: true, data: getResourceIndexSnapshot(undefined) }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })
}
