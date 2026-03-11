import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testState = vi.hoisted(() => ({
  appRoot: '',
  spacePaths: [] as string[]
}))

vi.mock('../../../src/main/services/config.service', () => ({
  getConfig: vi.fn(() => ({
    claudeCode: {
      resourceRuntimePolicy: 'app-single-source',
      plugins: {
        enabled: true,
        globalPaths: []
      },
      agents: {
        paths: []
      }
    }
  }))
}))

vi.mock('../../../src/main/services/space-config.service', () => ({
  getSpaceConfig: vi.fn(() => ({
    claudeCode: {
      resourceRuntimePolicy: 'full-mesh'
    }
  }))
}))

vi.mock('../../../src/main/services/config-source-mode.service', () => ({
  getLockedConfigSourceMode: vi.fn(() => 'kite'),
  getLockedUserConfigRootDir: vi.fn(() => testState.appRoot)
}))

vi.mock('../../../src/main/services/plugins.service', () => ({
  listEnabledPlugins: vi.fn(() => [])
}))

vi.mock('../../../src/main/services/space.service', () => ({
  getAllSpacePaths: vi.fn(() => testState.spacePaths)
}))

import {
  clearSkillsCache,
  copySkillToSpaceByRef,
  getSkillDefinition,
  listSkills
} from '../../../src/main/services/skills.service'
import {
  clearCommandsCache,
  copyCommandToSpaceByRef,
  getCommand,
  listCommands
} from '../../../src/main/services/commands.service'
import {
  clearAgentsCache,
  copyAgentToSpaceByRef,
  getAgent,
  listAgents
} from '../../../src/main/services/agents.service'

function writeSkill(rootDir: string, name: string, content?: string): void {
  const skillDir = join(rootDir, 'skills', name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), content || `# ${name}\n`, 'utf-8')
}

function writeCommand(rootDir: string, name: string, content?: string): void {
  mkdirSync(join(rootDir, 'commands'), { recursive: true })
  writeFileSync(join(rootDir, 'commands', `${name}.md`), content || `# ${name}\n`, 'utf-8')
}

function writeAgent(rootDir: string, name: string, content?: string): void {
  mkdirSync(join(rootDir, 'agents'), { recursive: true })
  writeFileSync(join(rootDir, 'agents', `${name}.md`), content || `# ${name}\n`, 'utf-8')
}

function writeSpaceSkill(spaceDir: string, name: string, content?: string): void {
  const skillDir = join(spaceDir, '.claude', 'skills', name)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), content || `# ${name}\n`, 'utf-8')
}

function writeSpaceCommand(spaceDir: string, name: string, content?: string): void {
  mkdirSync(join(spaceDir, '.claude', 'commands'), { recursive: true })
  writeFileSync(join(spaceDir, '.claude', 'commands', `${name}.md`), content || `# ${name}\n`, 'utf-8')
}

function writeSpaceAgent(spaceDir: string, name: string, content?: string): void {
  mkdirSync(join(spaceDir, '.claude', 'agents'), { recursive: true })
  writeFileSync(join(spaceDir, '.claude', 'agents', `${name}.md`), content || `# ${name}\n`, 'utf-8')
}

describe('full-mesh 资源聚合优先级', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'full-mesh-res-'))
  const appRoot = join(tempRoot, 'app-root')
  const spaceA = join(tempRoot, 'space-a')
  const spaceB = join(tempRoot, 'space-b')
  const spaceC = join(tempRoot, 'space-c')

  beforeAll(() => {
    testState.appRoot = appRoot
    testState.spacePaths = [spaceC, spaceB, spaceA]

    writeSkill(appRoot, 'shared')
    writeSkill(appRoot, 'lex')
    writeCommand(appRoot, 'shared')
    writeCommand(appRoot, 'lex')
    writeAgent(appRoot, 'shared')
    writeAgent(appRoot, 'lex')

    writeSpaceSkill(spaceA, 'shared', '# shared-from-space-a\n')
    writeSpaceSkill(spaceB, 'shared', '# shared-from-space-b\n')
    writeSpaceSkill(spaceA, 'lex', '# lex-from-space-a\n')
    writeSpaceSkill(spaceC, 'lex', '# lex-from-space-c\n')

    writeSpaceCommand(spaceA, 'shared', '# shared-from-space-a\n')
    writeSpaceCommand(spaceB, 'shared', '# shared-from-space-b\n')
    writeSpaceCommand(spaceA, 'lex', '# lex-from-space-a\n')
    writeSpaceCommand(spaceC, 'lex', '# lex-from-space-c\n')

    writeSpaceAgent(spaceA, 'shared', '# shared-from-space-a\n')
    writeSpaceAgent(spaceB, 'shared', '# shared-from-space-b\n')
    writeSpaceAgent(spaceA, 'lex', '# lex-from-space-a\n')
    writeSpaceAgent(spaceC, 'lex', '# lex-from-space-c\n')
  })

  beforeEach(() => {
    clearSkillsCache()
    clearCommandsCache()
    clearAgentsCache()
  })

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('skills 按 current > 其他空间字典序 > global 命中', () => {
    const shared = getSkillDefinition('shared', spaceB)
    const lex = getSkillDefinition('lex', spaceB)
    const all = listSkills(spaceB, 'taxonomy-admin')

    expect(shared?.path).toContain(join('space-b', '.claude', 'skills', 'shared'))
    expect(lex?.path).toContain(join('space-a', '.claude', 'skills', 'lex'))
    expect(all.some((skill) => skill.path.includes(join('space-a', '.claude', 'skills', 'lex')))).toBe(true)
  })

  it('commands 按 current > 其他空间字典序 > global 命中', () => {
    const shared = getCommand('shared', spaceB)
    const lex = getCommand('lex', spaceB)
    const all = listCommands(spaceB, 'taxonomy-admin')

    expect(shared?.path).toContain(join('space-b', '.claude', 'commands', 'shared.md'))
    expect(lex?.path).toContain(join('space-a', '.claude', 'commands', 'lex.md'))
    expect(all.some((command) => command.path.includes(join('space-a', '.claude', 'commands', 'lex.md')))).toBe(true)
  })

  it('agents 按 current > 其他空间字典序 > global 命中', () => {
    const shared = getAgent('shared', spaceB)
    const lex = getAgent('lex', spaceB)
    const all = listAgents(spaceB, 'taxonomy-admin')

    expect(shared?.path).toContain(join('space-b', '.claude', 'agents', 'shared.md'))
    expect(lex?.path).toContain(join('space-a', '.claude', 'agents', 'lex.md'))
    expect(all.some((agent) => agent.path.includes(join('space-a', '.claude', 'agents', 'lex.md')))).toBe(true)
  })

  it('copySkillToSpaceByRef 在 full-mesh 下优先命中当前空间同名 skill', () => {
    const result = copySkillToSpaceByRef({ type: 'skill', name: 'shared' }, spaceB)

    expect(result.status).toBe('copied')
    expect(result.data?.path).toContain(join('space-b', '.claude', 'skills', 'shared'))
  })

  it('copyCommandToSpaceByRef 在 full-mesh 下优先命中当前空间同名 command', () => {
    const result = copyCommandToSpaceByRef({ type: 'command', name: 'shared' }, spaceB)

    expect(result.status).toBe('copied')
    expect(result.data?.path).toContain(join('space-b', '.claude', 'commands', 'shared.md'))
  })

  it('copyAgentToSpaceByRef 在 full-mesh 下优先命中当前空间同名 agent', () => {
    const result = copyAgentToSpaceByRef({ type: 'agent', name: 'shared' }, spaceB)

    expect(result.status).toBe('copied')
    expect(result.data?.path).toContain(join('space-b', '.claude', 'agents', 'shared.md'))
  })

  it('同一空间重复读取时，full-mesh 聚合日志仅输出一次（命中合并缓存）', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      listSkills(spaceB, 'taxonomy-admin')
      listSkills(spaceB, 'taxonomy-admin')
      listAgents(spaceB, 'taxonomy-admin')
      listAgents(spaceB, 'taxonomy-admin')
      listCommands(spaceB, 'taxonomy-admin')
      listCommands(spaceB, 'taxonomy-admin')

      const skillsAggregatedLogCount = logSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('[Skills][full-mesh] Aggregated resources')
      ).length
      const agentsAggregatedLogCount = logSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('[Agents][full-mesh] Aggregated resources')
      ).length
      const commandsAggregatedLogCount = logSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('[Commands][full-mesh] Aggregated resources')
      ).length

      expect(skillsAggregatedLogCount).toBe(1)
      expect(agentsAggregatedLogCount).toBe(1)
      expect(commandsAggregatedLogCount).toBe(1)
    } finally {
      logSpy.mockRestore()
    }
  })

  it('locale 别名 (zh-CN/zh_CN) 命中同一份 full-mesh 缓存', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      listSkills(spaceB, 'taxonomy-admin', 'zh-CN')
      listSkills(spaceB, 'taxonomy-admin', 'zh_CN')
      listAgents(spaceB, 'taxonomy-admin', 'zh-CN')
      listAgents(spaceB, 'taxonomy-admin', 'zh_CN')
      listCommands(spaceB, 'taxonomy-admin', 'zh-CN')
      listCommands(spaceB, 'taxonomy-admin', 'zh_CN')

      const skillsAggregatedLogCount = logSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('[Skills][full-mesh] Aggregated resources')
      ).length
      const agentsAggregatedLogCount = logSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('[Agents][full-mesh] Aggregated resources')
      ).length
      const commandsAggregatedLogCount = logSpy.mock.calls.filter((call) =>
        typeof call[0] === 'string' && call[0].includes('[Commands][full-mesh] Aggregated resources')
      ).length

      expect(skillsAggregatedLogCount).toBe(1)
      expect(agentsAggregatedLogCount).toBe(1)
      expect(commandsAggregatedLogCount).toBe(1)
    } finally {
      logSpy.mockRestore()
    }
  })
})
