import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rebuildAllResourceIndexesMock } = vi.hoisted(() => ({
  rebuildAllResourceIndexesMock: vi.fn()
}))

vi.mock('electron', () => ({}))

vi.mock('fs', () => ({
  watch: vi.fn(() => ({ close: vi.fn() })),
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ isDirectory: () => false }))
}))

vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: vi.fn(() => ({})),
  getSpacesDir: vi.fn(() => '/home/test/.kite/spaces')
}))

vi.mock('../../../src/main/services/plugins.service', () => ({
  clearPluginsCache: vi.fn(),
  listEnabledPlugins: vi.fn(() => [])
}))

vi.mock('../../../src/main/services/skills.service', () => ({
  clearSkillsCache: vi.fn(),
  invalidateSkillsCache: vi.fn()
}))

vi.mock('../../../src/main/services/agents.service', () => ({
  clearAgentsCache: vi.fn(),
  invalidateAgentsCache: vi.fn()
}))

vi.mock('../../../src/main/services/commands.service', () => ({
  clearCommandsCache: vi.fn(),
  invalidateCommandsCache: vi.fn()
}))

vi.mock('../../../src/main/services/space.service', () => ({
  getAllSpacePaths: vi.fn(() => [])
}))

vi.mock('../../../src/main/services/config-source-mode.service', () => ({
  getLockedConfigSourceMode: vi.fn(() => 'kite'),
  getLockedUserConfigRootDir: vi.fn(() => '/home/test/.kite')
}))

vi.mock('../../../src/main/services/resource-exposure.service', () => ({
  clearResourceExposureCache: vi.fn(),
  getResourceExposureConfigPath: vi.fn(() => '/home/test/.kite/resource-exposure.json')
}))

vi.mock('../../../src/main/services/resource-display-i18n.service', () => ({
  clearResourceDisplayI18nCache: vi.fn(),
  getResourceDisplayI18nRoots: vi.fn(() => []),
  RESOURCE_DISPLAY_I18N_FILE_NAME: 'resource-display.i18n.json'
}))

vi.mock('../../../src/main/services/resource-index.service', () => ({
  clearResourceIndexSnapshot: vi.fn(),
  rebuildAllResourceIndexes: rebuildAllResourceIndexesMock,
  rebuildResourceIndex: vi.fn()
}))

import {
  cleanupSkillAgentWatchers,
  initSkillAgentWatchers
} from '../../../src/main/services/skills-agents-watch.service'

describe('skills-agents-watch initialization', () => {
  beforeEach(() => {
    rebuildAllResourceIndexesMock.mockClear()
    cleanupSkillAgentWatchers()
  })

  it('does not rebuild all resource indexes during startup watcher init', () => {
    initSkillAgentWatchers({} as never)
    expect(rebuildAllResourceIndexesMock).not.toHaveBeenCalled()
  })
})
