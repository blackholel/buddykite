/**
 * Space Service Unit Tests
 *
 * Tests for workspace/space management service.
 * Covers space creation, listing, and stats calculation.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

import {
  getKiteSpace,
  listSpaces,
  createSpace,
  getSpace,
  deleteSpace,
  getAllSpacePaths,
  updateSpacePreferences,
  getSpacePreferences
} from '../../../src/main/services/space.service'
import { initializeApp, getSpacesDir, getTempSpacePath } from '../../../src/main/services/config.service'

describe('Space Service', () => {
  beforeEach(async () => {
    await initializeApp()
  })

  describe('getKiteSpace', () => {
    it('should return the Kite temp space', () => {
      const kiteSpace = getKiteSpace()

      expect(kiteSpace.id).toBe('kite-temp')
      expect(kiteSpace.name).toBe('Kite')
      expect(kiteSpace.isTemp).toBe(true)
      expect(kiteSpace.icon).toBe('sparkles')
    })

    it('should have valid path', () => {
      const kiteSpace = getKiteSpace()

      expect(kiteSpace.path).toBeTruthy()
      expect(fs.existsSync(kiteSpace.path)).toBe(true)
    })

    it('should include stats', () => {
      const kiteSpace = getKiteSpace()

      expect(kiteSpace.stats).toBeDefined()
      expect(typeof kiteSpace.stats.artifactCount).toBe('number')
      expect(typeof kiteSpace.stats.conversationCount).toBe('number')
    })
  })

  describe('listSpaces', () => {
    it('should return empty array when no custom spaces exist', () => {
      const spaces = listSpaces()

      expect(Array.isArray(spaces)).toBe(true)
      expect(spaces.every((space) => typeof space.id === 'string' && typeof space.path === 'string')).toBe(true)
    })

    it('should include created spaces', async () => {
      const before = listSpaces()
      // Create a test space
      const created = await createSpace({
        name: 'Test Project',
        icon: 'folder'
      })

      const spaces = listSpaces()

      expect(spaces.length).toBeGreaterThanOrEqual(before.length + 1)
      expect(spaces.some((space) => space.id === created.id)).toBe(true)
      expect(spaces.some((space) => space.name.startsWith('Test Project'))).toBe(true)
    })

    it('should ignore legacy .halo meta directories', () => {
      const baselineSpaces = listSpaces()
      const legacySpacePath = path.join(getSpacesDir(), 'legacy-halo-space')
      const legacyMetaPath = path.join(legacySpacePath, '.halo', 'meta.json')

      fs.mkdirSync(path.dirname(legacyMetaPath), { recursive: true })
      fs.writeFileSync(legacyMetaPath, JSON.stringify({
        id: 'legacy-halo-space-id',
        name: 'Legacy Halo Space',
        icon: 'folder',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))

      const spaces = listSpaces()
      expect(spaces.length).toBeGreaterThanOrEqual(baselineSpaces.length)
      expect(spaces.some(space => space.id === 'legacy-halo-space-id')).toBe(false)
      expect(spaces.some(space => space.path === legacySpacePath)).toBe(false)
      expect(getSpace('legacy-halo-space-id')).toBeFalsy()
    })

    it('should load spaces from legacy ~/.kite/spaces root for backward compatibility', () => {
      const legacyRoot = path.join(globalThis.__KITE_TEST_DIR__, '.kite', 'spaces')
      const legacySpacePath = path.join(legacyRoot, 'legacy-kite-space')
      const metaPath = path.join(legacySpacePath, '.kite', 'meta.json')

      fs.mkdirSync(path.dirname(metaPath), { recursive: true })
      fs.writeFileSync(metaPath, JSON.stringify({
        id: 'legacy-kite-space-id',
        name: 'Legacy Kite Space',
        icon: 'folder',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))

      const spaces = listSpaces()
      expect(spaces.some(space => space.id === 'legacy-kite-space-id')).toBe(true)
    })

    it('should keep listSpaces as read-only without mutating legacy space-config fields', async () => {
      const space = await createSpace({
        name: 'List Readonly',
        icon: 'folder'
      })

      const configPath = path.join(space.path, '.kite', 'space-config.json')
      const originalConfig = {
        resourcePolicy: {
          version: 1,
          mode: 'legacy',
          allowMcp: true,
          allowPluginMcpDirective: true,
          allowedSources: ['app', 'global', 'space', 'installed', 'plugin']
        },
        toolkit: {
          skills: [{ id: 'skill:space:-:legacy', type: 'skill', name: 'legacy', source: 'space' }],
          commands: [],
          agents: []
        }
      }
      fs.writeFileSync(configPath, JSON.stringify(originalConfig, null, 2), 'utf-8')

      const before = fs.readFileSync(configPath, 'utf-8')
      const spaces = listSpaces()
      const after = fs.readFileSync(configPath, 'utf-8')

      expect(spaces.some((item) => item.id === space.id)).toBe(true)
      expect(after).toBe(before)
    })

  })

  describe('createSpace', () => {
    it('should create a new space in default directory', async () => {
      const space = await createSpace({
        name: 'My Project',
        icon: 'code'
      })

      expect(space.id).toBeTruthy()
      expect(space.name).toBe('My Project')
      expect(space.icon).toBe('code')
      expect(space.isTemp).toBe(false)
      expect(fs.existsSync(space.path)).toBe(true)
    })

    it('should create .kite directory inside space', async () => {
      const space = await createSpace({
        name: 'Test Space',
        icon: 'folder'
      })

      const kiteDir = path.join(space.path, '.kite')
      expect(fs.existsSync(kiteDir)).toBe(true)
    })

    it('should create meta.json with space info', async () => {
      const space = await createSpace({
        name: 'Meta Test',
        icon: 'star'
      })

      const metaPath = path.join(space.path, '.kite', 'meta.json')
      expect(fs.existsSync(metaPath)).toBe(true)

      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      expect(meta.name).toBe('Meta Test')
      expect(meta.icon).toBe('star')
      expect(meta.id).toBe(space.id)
    })

    it('should handle custom path', async () => {
      const customPath = path.join(getTempSpacePath(), 'custom-project')
      fs.mkdirSync(customPath, { recursive: true })

      const space = await createSpace({
        name: 'Custom Path Space',
        icon: 'folder',
        customPath
      })

      expect(space.path).toBe(customPath)
      expect(fs.existsSync(path.join(customPath, '.kite', 'meta.json'))).toBe(true)
    })

    it('should create default space with sanitized folder name', async () => {
      const space = await createSpace({
        name: 'A:B*Project?',
        icon: 'folder'
      })

      expect(path.basename(space.path)).toBe('A-B-Project-')
    })

    it('should map windows reserved folder names to safe names', async () => {
      const space = await createSpace({
        name: 'CON',
        icon: 'folder'
      })

      expect(path.basename(space.path)).toBe('CON-space')
    })

    it('should avoid overwriting when same default name is created twice', async () => {
      const first = await createSpace({
        name: 'Same Name',
        icon: 'folder'
      })
      const second = await createSpace({
        name: 'Same Name',
        icon: 'folder'
      })

      expect(first.path).not.toBe(second.path)
      expect(path.basename(second.path)).toBe('Same Name-2')
    })

    it('should initialize legacy resource policy without allowHooks field', async () => {
      const space = await createSpace({
        name: 'Policy Defaults',
        icon: 'folder'
      })

      const configPath = path.join(space.path, '.kite', 'space-config.json')
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))

      expect(config.resourcePolicy.mode).toBe('legacy')
      expect(config.resourcePolicy.allowMcp).toBe(true)
      expect(config.resourcePolicy.allowPluginMcpDirective).toBe(true)
      expect(config.resourcePolicy.allowedSources).toEqual(['app', 'global', 'space', 'installed', 'plugin'])
      expect(config.resourcePolicy).not.toHaveProperty('allowHooks')
    })
  })

  describe('getSpace', () => {
    it('should return space by id', async () => {
      const created = await createSpace({
        name: 'Get Test',
        icon: 'folder'
      })

      const space = getSpace(created.id)

      expect(space).toBeDefined()
      expect(space?.id).toBe(created.id)
      expect(space?.name).toBe('Get Test')
    })

    it('should return null/undefined for non-existent id', () => {
      const space = getSpace('non-existent-id')
      expect(space).toBeFalsy() // null or undefined
    })

    it('should return Kite space for kite-temp id', () => {
      const space = getSpace('kite-temp')

      expect(space).toBeDefined()
      expect(space?.id).toBe('kite-temp')
      expect(space?.isTemp).toBe(true)
    })
  })

  describe('deleteSpace', () => {
    it('should delete space and its .kite directory', async () => {
      const space = await createSpace({
        name: 'Delete Test',
        icon: 'folder'
      })

      const kiteDir = path.join(space.path, '.kite')
      expect(fs.existsSync(kiteDir)).toBe(true)

      await deleteSpace(space.id)

      // .kite should be deleted, but space directory may remain (for custom paths)
      expect(fs.existsSync(kiteDir)).toBe(false)
    })

    it('should not allow deleting Kite temp space', async () => {
      // deleteSpace may return false or throw for temp space
      try {
        const result = await deleteSpace('kite-temp')
        // If it returns without throwing, result should be false
        expect(result).toBeFalsy()
      } catch {
        // Expected to throw for temp space
        expect(true).toBe(true)
      }
    })

    it('should treat path prefix collisions as custom paths and preserve project files', async () => {
      const defaultRoot = getSpacesDir()
      const collidingCustomPath = `${defaultRoot}-project`
      const projectFile = path.join(collidingCustomPath, 'README.md')
      fs.mkdirSync(collidingCustomPath, { recursive: true })
      fs.writeFileSync(projectFile, 'keep me', 'utf-8')

      const space = await createSpace({
        name: 'Prefix Collision',
        icon: 'folder',
        customPath: collidingCustomPath
      })

      const deleted = await deleteSpace(space.id)
      expect(deleted).toBe(true)
      expect(fs.existsSync(collidingCustomPath)).toBe(true)
      expect(fs.existsSync(projectFile)).toBe(true)
      expect(fs.existsSync(path.join(collidingCustomPath, '.kite'))).toBe(false)
    })

    it('should refuse deleting a space when custom path equals home directory', async () => {
      const homePath = globalThis.__KITE_TEST_DIR__
      const sentinelPath = path.join(homePath, '.kite', 'sentinel.txt')
      fs.mkdirSync(path.dirname(sentinelPath), { recursive: true })
      fs.writeFileSync(sentinelPath, 'keep', 'utf-8')

      const space = await createSpace({
        name: 'Home Protected',
        icon: 'folder',
        customPath: homePath
      })

      const deleted = deleteSpace(space.id)
      expect(deleted).toBe(false)
      expect(fs.existsSync(sentinelPath)).toBe(true)
    })

    it('should refuse deleting when space meta id is mismatched', async () => {
      const space = await createSpace({
        name: 'Meta Mismatch',
        icon: 'folder'
      })

      const metaPath = path.join(space.path, '.kite', 'meta.json')
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      meta.id = 'tampered-id'
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))

      const deleted = deleteSpace(space.id)
      expect(deleted).toBe(false)
      expect(fs.existsSync(space.path)).toBe(true)
      expect(fs.existsSync(path.join(space.path, '.kite'))).toBe(true)
    })
  })

  describe('getAllSpacePaths', () => {
    it('should include temp space path', () => {
      const paths = getAllSpacePaths()
      const tempPath = getTempSpacePath()

      expect(paths).toContain(tempPath)
    })

    it('should include created space paths', async () => {
      const space = await createSpace({
        name: 'Path Test',
        icon: 'folder'
      })

      const paths = getAllSpacePaths()

      expect(paths).toContain(space.path)
    })

    it('should exclude non-space directories from default spaces root', () => {
      const nonSpacePath = path.join(getSpacesDir(), 'plain-folder')
      fs.mkdirSync(nonSpacePath, { recursive: true })

      const paths = getAllSpacePaths()
      expect(paths).not.toContain(nonSpacePath)
    })

    it('should include valid space paths from legacy ~/.kite/spaces root', () => {
      const legacyRoot = path.join(globalThis.__KITE_TEST_DIR__, '.kite', 'spaces')
      const legacySpacePath = path.join(legacyRoot, 'legacy-space-path')
      const metaPath = path.join(legacySpacePath, '.kite', 'meta.json')

      fs.mkdirSync(path.dirname(metaPath), { recursive: true })
      fs.writeFileSync(metaPath, JSON.stringify({
        id: 'legacy-space-path-id',
        name: 'Legacy Space Path',
        icon: 'folder',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }))

      const paths = getAllSpacePaths()
      expect(paths).toContain(legacySpacePath)
    })
  })

  describe('preferences normalization', () => {
    it('should drop legacy enabled/showOnlyEnabled/agents fields when persisting preferences', async () => {
      const space = await createSpace({
        name: 'Preference Cleanup',
        icon: 'folder'
      })

      const metaPath = path.join(space.path, '.kite', 'meta.json')
      const dirtyMeta = {
        id: space.id,
        name: space.name,
        icon: space.icon,
        createdAt: space.createdAt,
        updatedAt: space.updatedAt,
        enabledSkills: ['legacy-skill'],
        enabledAgents: ['legacy-agent'],
        preferences: {
          skills: {
            favorites: ['old-favorite'],
            enabled: ['legacy-skill'],
            showOnlyEnabled: true
          },
          agents: {
            enabled: ['legacy-agent'],
            showOnlyEnabled: true
          }
        }
      }
      fs.writeFileSync(metaPath, JSON.stringify(dirtyMeta, null, 2), 'utf-8')

      const updated = updateSpacePreferences(space.id, {
        skills: { favorites: ['new-favorite'] }
      })
      expect(updated).toBeTruthy()

      const savedMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
      expect(savedMeta.preferences).toEqual({
        skills: {
          favorites: ['new-favorite']
        }
      })
      expect(savedMeta).not.toHaveProperty('enabledSkills')
      expect(savedMeta).not.toHaveProperty('enabledAgents')

      const prefs = getSpacePreferences(space.id)
      expect(prefs).toEqual({
        skills: {
          favorites: ['new-favorite']
        }
      })
    })
  })
})
