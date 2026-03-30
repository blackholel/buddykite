import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildResourceLibraryStateKey,
  deleteResourceState,
  getResourceEnabledState,
  getResourceLibraryStatePath,
  pruneMissingResourceState,
  readResourceLibraryState,
  setResourceEnabledState,
  writeResourceLibraryState
} from '../resource-library-state.service'

describe('resource-library-state.service', () => {
  const cleanupDirs: string[] = []

  afterEach(() => {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    cleanupDirs.length = 0
  })

  function setupConfigDir(): string {
    const configDir = join(tmpdir(), `kite-resource-state-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(configDir, { recursive: true })
    cleanupDirs.push(configDir)
    return configDir
  }

  it('defaults resources to enabled when no state exists', () => {
    const configDir = setupConfigDir()
    const key = buildResourceLibraryStateKey('skill', 'app', 'review')

    const state = readResourceLibraryState(configDir)
    expect(state.resources).toEqual({})
    expect(getResourceEnabledState(key, configDir)).toBe(true)
  })

  it('reads and writes enabled state entries', () => {
    const configDir = setupConfigDir()
    const key = buildResourceLibraryStateKey('skill', 'app', 'review')

    setResourceEnabledState(key, false, configDir)
    const state = readResourceLibraryState(configDir)
    expect(state.resources[key]?.enabled).toBe(false)
    expect(getResourceEnabledState(key, configDir)).toBe(false)

    setResourceEnabledState(key, true, configDir)
    expect(getResourceEnabledState(key, configDir)).toBe(true)
  })

  it('supports delete and prune operations', () => {
    const configDir = setupConfigDir()
    const keyA = buildResourceLibraryStateKey('skill', 'app', 'a')
    const keyB = buildResourceLibraryStateKey('agent', 'plugin', 'planner', 'superpowers')
    writeResourceLibraryState({
      schemaVersion: 1,
      resources: {
        [keyA]: { enabled: false, updatedAt: '2026-01-01T00:00:00.000Z' },
        [keyB]: { enabled: true, updatedAt: '2026-01-02T00:00:00.000Z' }
      }
    }, configDir)

    deleteResourceState(keyA, configDir)
    expect(readResourceLibraryState(configDir).resources[keyA]).toBeUndefined()

    pruneMissingResourceState([keyA], configDir)
    const state = readResourceLibraryState(configDir)
    expect(state.resources[keyA]).toBeUndefined()
    expect(state.resources[keyB]).toBeUndefined()
  })

  it('falls back to default state when file is invalid json', () => {
    const configDir = setupConfigDir()
    const statePath = getResourceLibraryStatePath(configDir)
    writeFileSync(statePath, '{ bad json', 'utf-8')

    const state = readResourceLibraryState(configDir)
    expect(state.resources).toEqual({})
    expect(existsSync(statePath)).toBe(true)
  })
})
