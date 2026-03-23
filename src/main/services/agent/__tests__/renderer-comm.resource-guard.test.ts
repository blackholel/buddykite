import { describe, expect, it, vi } from 'vitest'

vi.mock('../../config.service', () => ({
  getConfig: vi.fn(() => ({
    permissions: {
      commandExecution: 'allow',
      trustMode: true
    },
    claudeCode: {
      plugins: {
        globalPaths: ['.kite-global']
      },
      agents: {
        paths: ['.kite-agents']
      }
    }
  }))
}))

vi.mock('../../chrome-debug-launcher.service', () => ({
  ensureChromeDebugModeReadyForMcp: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../../../http/websocket', () => ({
  broadcastToWebSocket: vi.fn()
}))

vi.mock('../../config-source-mode.service', () => ({
  getLockedUserConfigRootDir: vi.fn(() => '/home/test/.kite')
}))

vi.mock('../../plugins.service', () => ({
  listEnabledPlugins: vi.fn(() => [
    {
      installPath: '/home/test/.kite/plugins/mock-plugin'
    }
  ])
}))

vi.mock('../../space.service', () => ({
  getAllSpacePaths: vi.fn(() => ['/workspace/project', '/workspace/space-a', '/workspace/space-b'])
}))

vi.mock('../space-resource-policy.service', () => ({
  getExecutionLayerAllowedSources: vi.fn(() => ['app', 'global', 'space', 'installed', 'plugin']),
  getSpaceResourcePolicy: vi.fn(() => ({
    version: 1,
    mode: 'strict-space-only',
    allowedSources: ['app', 'global', 'space', 'installed', 'plugin']
  })),
  isStrictSpaceOnlyPolicy: vi.fn(() => true)
}))

import { ensureChromeDebugModeReadyForMcp } from '../../chrome-debug-launcher.service'
import { createCanUseTool, resolveToolPolicyConflict } from '../renderer-comm'

function createHandler() {
  return createCanUseTool(
    '/workspace/project',
    'space-1',
    'conversation-1',
    () => undefined
  )
}

function createHandlerWithRuntimePolicy(resourceRuntimePolicy: 'app-single-source' | 'legacy' | 'full-mesh') {
  return createCanUseTool(
    '/workspace/project',
    'space-1',
    'conversation-1',
    () => undefined,
    { resourceRuntimePolicy }
  )
}

function createHandlerWithSlashRuntimeMode(slashRuntimeMode: 'native' | 'legacy-inject') {
  return createCanUseTool(
    '/workspace/project',
    'space-1',
    'conversation-1',
    () => undefined,
    { slashRuntimeMode }
  )
}

function createHandlerWithToolObserver(onToolUse: (toolName: string, input: Record<string, unknown>) => void) {
  return createCanUseTool(
    '/workspace/project',
    'space-1',
    'conversation-1',
    () => undefined,
    { onToolUse }
  )
}

describe('renderer-comm resource-dir guard', () => {
  it('allows Write on protected skill directory', async () => {
    const canUseTool = createHandler()
    const input = { file_path: '.claude/skills/demo/SKILL.md' }
    const result = await canUseTool(
      'Write',
      input,
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
    expect(result.updatedInput).toEqual(input)
  })

  it('allows Edit on protected agent directory', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Edit',
      { file_path: '/workspace/project/.claude/agents/reviewer.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
  })

  it('allows Bash touching protected command directory', async () => {
    const canUseTool = createHandler()
    const input = { command: 'echo "# cmd" > .claude/commands/release.md' }
    const result = await canUseTool(
      'Bash',
      input,
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
    expect(result.updatedInput).toEqual(input)
  })

  it('allows Bash when command does not touch protected directories', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Bash',
      { command: 'echo "hello world"' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
  })

  it('denies Bash opening local html page in browser (force inline widget rendering)', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Bash',
      { command: 'open /workspace/project/tmp/chart-preview.html' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('deny')
    expect(result.message).toContain('show-widget')
  })

  it('denies Bash opening external web url in browser launcher', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Bash',
      { command: 'xdg-open https://example.com/dashboard' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('deny')
    expect(result.message).toContain('show-widget')
  })

  it('denies Bash absolute path outside current workDir in strict space mode', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Bash',
      { command: 'open /Users/dl/ProjectSpace/ownerAgent/hello-halo/README.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('deny')
    expect(result.message).toContain('Strict space mode')
    expect((result as { errorCode?: string }).errorCode).toBe('FS_BOUNDARY_VIOLATION')
  })

  it('denies Bash directory traversal in strict space mode', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Bash',
      { command: 'cd ../ && ls' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('deny')
    expect(result.message).toContain('Strict space mode')
  })

  it('denies Write outside current workDir', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Write',
      { file_path: '/tmp/other-workspace/README.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('deny')
    expect(result.message).toContain('current space or approved global resource roots')
    expect((result as { errorCode?: string }).errorCode).toBe('FS_BOUNDARY_VIOLATION')
  })

  it('allows Read in app global resource root', async () => {
    const canUseTool = createHandler()
    const input = { file_path: '/home/test/.kite/skills/brainstorming/SKILL.md' }
    const result = await canUseTool(
      'Read',
      input,
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
    expect(result.updatedInput).toEqual(input)
  })

  it('allows chrome-devtools MCP tool and prewarms debug endpoint', async () => {
    vi.mocked(ensureChromeDebugModeReadyForMcp).mockClear()
    const canUseTool = createHandler()
    const input = { type: 'url', url: 'https://www.baidu.com' }
    const result = await canUseTool(
      'mcp__chrome-devtools__navigate_page',
      input,
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
    expect(result.updatedInput).toEqual(input)
    expect(ensureChromeDebugModeReadyForMcp).toHaveBeenCalled()
  })

  it('does not prewarm debug endpoint for non chrome-devtools tools', async () => {
    vi.mocked(ensureChromeDebugModeReadyForMcp).mockClear()
    const canUseTool = createHandler()
    const input = { file_path: '/workspace/project/README.md' }
    const result = await canUseTool(
      'Read',
      input,
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
    expect(result.updatedInput).toEqual(input)
    expect(ensureChromeDebugModeReadyForMcp).not.toHaveBeenCalled()
  })

  it('allows Bash access to configured global path', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Bash',
      { command: 'open /home/test/.kite/plugins/mock-plugin/skills/brainstorming/SKILL.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
  })

  it('allows Read in app agents subdirectory', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Read',
      { file_path: '/home/test/.kite/agents/reviewer.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
  })

  it('allows Write in app commands subdirectory', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Write',
      { file_path: '/home/test/.kite/commands/deploy.md', content: '# Deploy' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
  })

  it('allows Read in plugin agents subdirectory', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Read',
      { file_path: '/home/test/.kite/plugins/mock-plugin/agents/code-reviewer.md' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
  })

  it('allows Edit in space skills subdirectory', async () => {
    const canUseTool = createHandler()
    const result = await canUseTool(
      'Edit',
      { file_path: '/workspace/project/.claude/skills/custom/SKILL.md', old_string: 'old', new_string: 'new' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
  })

  it('native 模式下 Skill 工具允许', async () => {
    const appSingleSourceHandler = createHandlerWithRuntimePolicy('app-single-source')
    const legacyRuntimePolicyHandler = createHandlerWithRuntimePolicy('legacy')

    const appSingleSourceResult = await appSingleSourceHandler(
      'Skill',
      { skill: 'demo' },
      { signal: new AbortController().signal }
    )
    const legacyRuntimePolicyResult = await legacyRuntimePolicyHandler(
      'Skill',
      { skill: 'demo' },
      { signal: new AbortController().signal }
    )

    expect(appSingleSourceResult.behavior).toBe('allow')
    expect(legacyRuntimePolicyResult.behavior).toBe('allow')
  })

  it('legacy-inject 模式下 Skill 工具禁用', async () => {
    const canUseTool = createHandlerWithSlashRuntimeMode('legacy-inject')
    const result = await canUseTool(
      'Skill',
      { skill: 'demo' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('deny')
  })

  it('full-mesh 策略在运行时降级后 native 仍允许 Skill 且不放宽跨 space 资源根', async () => {
    const canUseTool = createHandlerWithRuntimePolicy('full-mesh')
    const skillResult = await canUseTool(
      'Skill',
      { skill: 'demo' },
      { signal: new AbortController().signal }
    )
    const crossSpaceReadResult = await canUseTool(
      'Read',
      { file_path: '/workspace/space-a/.claude/skills/demo/SKILL.md' },
      { signal: new AbortController().signal }
    )

    expect(skillResult.behavior).toBe('allow')
    expect(crossSpaceReadResult.behavior).toBe('deny')
  })

  it('冲突矩阵满足 deny 优先与分层优先级', () => {
    const winner = resolveToolPolicyConflict([
      { layer: 'GlobalPolicy', outcome: 'allow', rule: 'global_allow' },
      { layer: 'SpacePolicy', outcome: 'allow', rule: 'space_allow' },
      { layer: 'ModePolicy', outcome: 'deny', rule: 'mode_deny' }
    ])
    expect(winner?.layer).toBe('ModePolicy')
    expect(winner?.outcome).toBe('deny')

    const hardSafetyWinner = resolveToolPolicyConflict([
      { layer: 'ModePolicy', outcome: 'deny', rule: 'mode_deny' },
      { layer: 'HardSafetyDeny', outcome: 'deny', rule: 'hard_deny' }
    ])
    expect(hardSafetyWinner?.layer).toBe('HardSafetyDeny')
    expect(hardSafetyWinner?.outcome).toBe('deny')
  })

  it('全局/空间/模式三层策略真值表满足 deny 优先', () => {
    const outcomes = ['allow', 'deny', 'abstain'] as const
    const buildEntry = (layer: 'ModePolicy' | 'SpacePolicy' | 'GlobalPolicy', outcome: 'allow' | 'deny' | 'abstain') => ({
      layer,
      outcome,
      rule: `${layer}:${outcome}`
    })

    for (const modeOutcome of outcomes) {
      for (const spaceOutcome of outcomes) {
        for (const globalOutcome of outcomes) {
          const trace = [
            buildEntry('ModePolicy', modeOutcome),
            buildEntry('SpacePolicy', spaceOutcome),
            buildEntry('GlobalPolicy', globalOutcome)
          ]
          const winner = resolveToolPolicyConflict(trace)

          const expectedDenyLayer = (['ModePolicy', 'SpacePolicy', 'GlobalPolicy'] as const).find((layer) => {
            const target = trace.find((item) => item.layer === layer)
            return target?.outcome === 'deny'
          })
          const expectedAllowLayer = (['ModePolicy', 'SpacePolicy', 'GlobalPolicy'] as const).find((layer) => {
            const target = trace.find((item) => item.layer === layer)
            return target?.outcome === 'allow'
          })

          if (expectedDenyLayer) {
            expect(winner?.layer).toBe(expectedDenyLayer)
            expect(winner?.outcome).toBe('deny')
            continue
          }

          if (expectedAllowLayer) {
            expect(winner?.layer).toBe(expectedAllowLayer)
            expect(winner?.outcome).toBe('allow')
            continue
          }

          expect(winner).toBeNull()
        }
      }
    }
  })

  it('invokes onToolUse callback for allowed mutation tools', async () => {
    const onToolUse = vi.fn()
    const canUseTool = createHandlerWithToolObserver(onToolUse)

    const result = await canUseTool(
      'Write',
      { file_path: 'src/main.ts', content: 'hello' },
      { signal: new AbortController().signal }
    )

    expect(result.behavior).toBe('allow')
    expect(onToolUse).toHaveBeenCalledWith('Write', {
      file_path: 'src/main.ts',
      content: 'hello'
    })
  })
})
