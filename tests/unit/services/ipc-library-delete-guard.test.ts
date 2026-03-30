import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'

const listSkillsMock = vi.fn(() => [])
const deleteSkillFromLibraryMock = vi.fn(() => true)
const listAgentsMock = vi.fn(() => [])
const deleteAgentFromLibraryMock = vi.fn(() => true)

vi.mock('../../../src/main/services/skills.service', () => ({
  listSkills: (...args: unknown[]) => listSkillsMock(...args),
  getSkillContent: vi.fn(),
  createSkill: vi.fn(),
  createSkillInLibrary: vi.fn(),
  updateSkill: vi.fn(),
  updateSkillInLibrary: vi.fn(),
  deleteSkill: vi.fn(),
  deleteSkillFromLibrary: (...args: unknown[]) => deleteSkillFromLibraryMock(...args),
  setSkillEnabledState: vi.fn(),
  saveSopSkill: vi.fn(),
  copySkillToSpaceByRef: vi.fn(),
  clearSkillsCache: vi.fn(),
  invalidateSkillsCache: vi.fn()
}))

vi.mock('../../../src/main/services/agents.service', () => ({
  listAgents: (...args: unknown[]) => listAgentsMock(...args),
  getAgentContent: vi.fn(),
  clearAgentsCache: vi.fn(),
  invalidateAgentsCache: vi.fn(),
  createAgent: vi.fn(),
  createAgentInLibrary: vi.fn(),
  updateAgent: vi.fn(),
  updateAgentInLibrary: vi.fn(),
  deleteAgent: vi.fn(),
  deleteAgentFromLibrary: (...args: unknown[]) => deleteAgentFromLibraryMock(...args),
  setAgentEnabledState: vi.fn(),
  copyAgentToSpaceByRef: vi.fn()
}))

vi.mock('../../../src/main/services/commands.service', () => ({
  clearCommandsCache: vi.fn(),
  invalidateCommandsCache: vi.fn()
}))

vi.mock('../../../src/main/services/plugins.service', () => ({
  clearPluginsCache: vi.fn()
}))

vi.mock('../../../src/main/services/resource-index.service', () => ({
  getResourceIndexSnapshot: vi.fn(() => ({ hash: 'h', generatedAt: '', reason: 'manual-refresh', counts: { skills: 0, agents: 0 } })),
  rebuildResourceIndex: vi.fn(() => ({ hash: 'h', generatedAt: '', reason: 'manual-refresh', counts: { skills: 0, agents: 0 } })),
  rebuildAllResourceIndexes: vi.fn()
}))

vi.mock('../../../src/main/services/resource-library-import.service', () => ({
  importSkillDirectory: vi.fn(),
  importAgentFile: vi.fn()
}))

vi.mock('../../../src/main/services/resource-draft-generator.service', () => ({
  generateSkillDraft: vi.fn(),
  generateAgentDraft: vi.fn()
}))

vi.mock('../../../src/main/services/kite-library.service', () => ({
  getKiteSkillsDir: vi.fn(() => '/tmp/Kite/Skills'),
  getKiteAgentsDir: vi.fn(() => '/tmp/Kite/Agents')
}))

vi.mock('../../../src/main/services/config-source-mode.service', () => ({
  getLockedUserConfigRootDir: vi.fn(() => '/tmp')
}))

import { registerSkillsHandlers } from '../../../src/main/ipc/skills'
import { registerAgentsHandlers } from '../../../src/main/ipc/agents'

function getIpcHandler(channel: string): ((event: unknown, ...args: unknown[]) => Promise<unknown>) {
  const calls = (ipcMain.handle as unknown as { mock: { calls: unknown[][] } }).mock.calls
  const entry = calls.find((call) => call[0] === channel)
  if (!entry) {
    throw new Error(`Handler not found for channel: ${channel}`)
  }
  return entry[1] as (event: unknown, ...args: unknown[]) => Promise<unknown>
}

describe('ipc library delete guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerSkillsHandlers()
    registerAgentsHandlers()
  })

  it('skills:delete-library 拒绝删除 plugin/installed 资源并返回错误码', async () => {
    listSkillsMock.mockReturnValue([
      { name: 'skill-plugin', path: '/tmp/plugins/skill-plugin', source: 'installed', enabled: true }
    ])
    const handler = getIpcHandler('skills:delete-library')
    const result = await handler({}, '/tmp/plugins/skill-plugin') as { success: boolean; errorCode?: string }

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('PLUGIN_RESOURCE_DELETE_FORBIDDEN')
    expect(deleteSkillFromLibraryMock).not.toHaveBeenCalled()
  })

  it('agents:delete-library 拒绝删除 plugin 资源并返回错误码', async () => {
    listAgentsMock.mockReturnValue([
      { name: 'agent-plugin', path: '/tmp/plugins/agent-plugin.md', source: 'plugin', enabled: true }
    ])
    const handler = getIpcHandler('agents:delete-library')
    const result = await handler({}, '/tmp/plugins/agent-plugin.md') as { success: boolean; errorCode?: string }

    expect(result.success).toBe(false)
    expect(result.errorCode).toBe('PLUGIN_RESOURCE_DELETE_FORBIDDEN')
    expect(deleteAgentFromLibraryMock).not.toHaveBeenCalled()
  })
})
