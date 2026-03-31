import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  spawnSyncMock,
  getKiteSkillsDirMock,
  resolveSeedDirMock,
  createSkillInLibraryMock,
  getPythonRuntimeStatusMock
} = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
  getKiteSkillsDirMock: vi.fn(),
  resolveSeedDirMock: vi.fn(),
  createSkillInLibraryMock: vi.fn(),
  getPythonRuntimeStatusMock: vi.fn()
}))

vi.mock('child_process', () => ({
  spawnSync: spawnSyncMock
}))

vi.mock('../config-source-mode.service', () => ({
  getLockedUserConfigRootDir: () => '/tmp/.kite'
}))

vi.mock('../kite-library.service', () => ({
  getKiteSkillsDir: getKiteSkillsDirMock
}))

vi.mock('../config.service', () => ({
  resolveSeedDir: resolveSeedDirMock,
  getConfig: vi.fn(() => ({}))
}))

vi.mock('../skills.service', () => ({
  createSkillInLibrary: createSkillInLibraryMock
}))

vi.mock('../runtime-python.service', () => ({
  getPythonRuntimeStatus: getPythonRuntimeStatusMock,
  installPythonRuntimeSilently: vi.fn(() => ({
    success: true,
    status: {
      found: true,
      pythonCommand: 'python3'
    }
  }))
}))

import {
  startStrictSkillRun,
  continueStrictSkillRun,
  submitStrictSkillFeedback,
  finalizeStrictSkillRun
} from '../skill-strict-creation.service'

describe('skill-strict-creation.service', () => {
  const cleanupDirs: string[] = []

  function createTempDir(prefix: string): string {
    const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    cleanupDirs.push(dir)
    return dir
  }

  beforeEach(() => {
    vi.clearAllMocks()

    const seedDir = createTempDir('skill-creator-seed')
    const skillsDir = createTempDir('kite-skills')
    const creatorBase = join(seedDir, 'skills', 'skill-creator')
    mkdirSync(join(creatorBase, 'scripts'), { recursive: true })
    mkdirSync(join(creatorBase, 'eval-viewer'), { recursive: true })
    writeFileSync(join(creatorBase, 'scripts', 'aggregate_benchmark.py'), '# mock script\n', 'utf-8')
    writeFileSync(join(creatorBase, 'eval-viewer', 'generate_review.py'), '# mock script\n', 'utf-8')

    resolveSeedDirMock.mockReturnValue(seedDir)
    getKiteSkillsDirMock.mockReturnValue(skillsDir)
    getPythonRuntimeStatusMock.mockReturnValue({
      found: true,
      pythonCommand: 'python3',
      pythonVersion: 'Python 3.12',
      pipReady: true,
      missingModules: [],
      installSupported: true,
      installStrategy: 'windows-system-silent'
    })
    spawnSyncMock.mockReturnValue({ status: 0, stdout: '', stderr: '' })
    createSkillInLibraryMock.mockImplementation((name: string, content: string) => ({
      name,
      path: join(skillsDir, name),
      content,
      source: 'app',
      enabled: true
    }))
  })

  afterEach(() => {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    cleanupDirs.length = 0
  })

  it('startStrictSkillRun 生成评测工件并进入 review-ready', () => {
    const state = startStrictSkillRun({ description: 'Need eval benchmark for review quality' })

    expect(state.stage).toBe('review-ready')
    expect(state.iteration).toBe(1)
    expect(existsSync(join(state.iterationDir, 'evals', 'evals.json'))).toBe(true)
    expect(existsSync(join(state.iterationDir, 'eval-1', 'with_skill', 'run-1', 'grading.json'))).toBe(true)
    expect(spawnSyncMock).toHaveBeenCalledTimes(2)
  })

  it('submit feedback 后 continue 会进入下一迭代', () => {
    const started = startStrictSkillRun({ description: 'Need review benchmark' })
    const feedbackState = submitStrictSkillFeedback({
      runId: started.runId,
      feedback: '请强化失败场景与回退建议'
    })
    expect(feedbackState.stage).toBe('feedback-collected')
    expect(existsSync(feedbackState.feedbackPath)).toBe(true)

    const continued = continueStrictSkillRun(started.runId)
    expect(continued.stage).toBe('review-ready')
    expect(continued.iteration).toBe(2)
    expect(existsSync(join(continued.iterationDir, 'evals', 'evals.json'))).toBe(true)
  })

  it('finalizeStrictSkillRun 会落库并返回 createdSkill', () => {
    const started = startStrictSkillRun({ description: 'Need review benchmark finalize' })
    const result = finalizeStrictSkillRun({
      runId: started.runId,
      name: 'strict-skill',
      content: '# strict-skill'
    })

    expect(result.state.stage).toBe('finalized')
    expect(createSkillInLibraryMock).toHaveBeenCalledWith('strict-skill', '# strict-skill')
    expect(result.createdSkill.path).toContain('strict-skill')
  })
})
