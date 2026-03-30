import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { mockGetLockedUserConfigRootDir } = vi.hoisted(() => ({
  mockGetLockedUserConfigRootDir: vi.fn()
}))

vi.mock('../config-source-mode.service', () => ({
  getLockedUserConfigRootDir: mockGetLockedUserConfigRootDir
}))

import { getKiteAgentsDir, getKiteSkillsDir } from '../kite-library.service'
import { readResourceLibraryState } from '../resource-library-state.service'
import { importAgentFile, importSkillDirectory } from '../resource-library-import.service'

describe('resource-library-import.service', () => {
  const cleanupDirs: string[] = []

  afterEach(() => {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    cleanupDirs.length = 0
    mockGetLockedUserConfigRootDir.mockReset()
  })

  function setupUserRoot(): string {
    const root = join(tmpdir(), `kite-resource-import-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    const configRoot = join(root, '.kite')
    mkdirSync(configRoot, { recursive: true })
    cleanupDirs.push(root)
    mockGetLockedUserConfigRootDir.mockReturnValue(configRoot)
    return configRoot
  }

  it('技能导入仅接受包含 SKILL.md 的目录', () => {
    setupUserRoot()
    const sourceDir = join(tmpdir(), `skill-source-${Date.now()}`)
    mkdirSync(sourceDir, { recursive: true })
    cleanupDirs.push(sourceDir)

    expect(() => importSkillDirectory(sourceDir)).toThrow('Skill directory must contain SKILL.md')
  })

  it('导入技能目录后写入 Kite/Skills 并默认启用', () => {
    const configRoot = setupUserRoot()
    const sourceRoot = join(tmpdir(), `skill-import-source-${Date.now()}`)
    const sourceDir = join(sourceRoot, 'review')
    mkdirSync(sourceDir, { recursive: true })
    cleanupDirs.push(sourceRoot)
    writeFileSync(join(sourceDir, 'SKILL.md'), '# review skill\n', 'utf-8')

    const result = importSkillDirectory(sourceDir)
    expect(result.status).toBe('imported')
    if (result.status !== 'imported') return

    const targetSkillPath = join(getKiteSkillsDir(configRoot), 'review', 'SKILL.md')
    expect(result.path).toBe(join(getKiteSkillsDir(configRoot), 'review'))
    expect(existsSync(targetSkillPath)).toBe(true)

    const state = readResourceLibraryState(configRoot)
    expect(state.resources['skill:app:review']?.enabled).toBe(true)
  })

  it('技能冲突返回 conflict，overwrite=true 时替换目标', () => {
    const configRoot = setupUserRoot()
    const sourceRoot = join(tmpdir(), `skill-overwrite-source-${Date.now()}`)
    const sourceDir = join(sourceRoot, 'planner')
    mkdirSync(sourceDir, { recursive: true })
    cleanupDirs.push(sourceRoot)
    writeFileSync(join(sourceDir, 'SKILL.md'), '# old planner\n', 'utf-8')

    const first = importSkillDirectory(sourceDir)
    expect(first.status).toBe('imported')

    writeFileSync(join(sourceDir, 'SKILL.md'), '# new planner\n', 'utf-8')
    const conflict = importSkillDirectory(sourceDir)
    expect(conflict).toEqual({
      status: 'conflict',
      existingPath: join(getKiteSkillsDir(configRoot), 'planner')
    })

    const overwrite = importSkillDirectory(sourceDir, { overwrite: true })
    expect(overwrite.status).toBe('imported')
    const targetSkillPath = join(getKiteSkillsDir(configRoot), 'planner', 'SKILL.md')
    expect(readFileSync(targetSkillPath, 'utf-8')).toContain('# new planner')
  })

  it('从库内同一路径覆盖导入技能时不会删除源目录', () => {
    const configRoot = setupUserRoot()
    const skillDir = join(getKiteSkillsDir(configRoot), 'same-path-skill')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '# same-path skill\n', 'utf-8')

    const result = importSkillDirectory(skillDir, { overwrite: true })
    expect(result).toEqual({
      status: 'imported',
      name: 'same-path-skill',
      path: skillDir
    })
    expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')).toContain('# same-path skill')
  })

  it('智能体导入仅接受 markdown 文件并支持冲突替换', () => {
    const configRoot = setupUserRoot()
    const sourceRoot = join(tmpdir(), `agent-import-source-${Date.now()}`)
    const sourceFile = join(sourceRoot, 'reviewer.md')
    mkdirSync(sourceRoot, { recursive: true })
    cleanupDirs.push(sourceRoot)
    writeFileSync(sourceFile, '# reviewer v1\n', 'utf-8')

    const imported = importAgentFile(sourceFile)
    expect(imported.status).toBe('imported')
    if (imported.status !== 'imported') return

    const targetPath = join(getKiteAgentsDir(configRoot), 'reviewer.md')
    expect(imported.path).toBe(targetPath)
    expect(existsSync(targetPath)).toBe(true)

    writeFileSync(sourceFile, '# reviewer v2\n', 'utf-8')
    const conflict = importAgentFile(sourceFile)
    expect(conflict).toEqual({ status: 'conflict', existingPath: targetPath })

    const overwrite = importAgentFile(sourceFile, { overwrite: true })
    expect(overwrite.status).toBe('imported')
    expect(readFileSync(targetPath, 'utf-8')).toContain('# reviewer v2')

    const state = readResourceLibraryState(configRoot)
    expect(state.resources['agent:app:reviewer']?.enabled).toBe(true)
  })

  it('从库内同一路径覆盖导入智能体时不会删除源文件', () => {
    const configRoot = setupUserRoot()
    const agentPath = join(getKiteAgentsDir(configRoot), 'same-path-agent.md')
    mkdirSync(getKiteAgentsDir(configRoot), { recursive: true })
    writeFileSync(agentPath, '# same-path agent\n', 'utf-8')

    const result = importAgentFile(agentPath, { overwrite: true })
    expect(result).toEqual({
      status: 'imported',
      name: 'same-path-agent',
      path: agentPath
    })
    expect(readFileSync(agentPath, 'utf-8')).toContain('# same-path agent')
  })
})
