import { describe, expect, it, vi } from 'vitest'

vi.mock('../../config.service', () => ({
  getConfig: vi.fn(() => ({
    claudeCode: {
      plugins: {
        enabled: true,
        globalPaths: ['/global/plugins'],
        loadDefaultPaths: true
      },
      skillsLazyLoad: false
    }
  })),
  getTempSpacePath: vi.fn(() => '/tmp/kite-temp')
}))

vi.mock('../../space-config.service', () => ({
  getSpaceConfig: vi.fn((workDir: string) => ({
    resourcePolicy: {
      version: 1,
      mode: 'strict-space-only'
    },
    claudeCode: {
      plugins: {
        paths: ['.local-plugins']
      }
    }
  })),
  updateSpaceConfig: vi.fn()
}))

const MOCK_HOOKS = {
  PreToolUse: [
    {
      matcher: '*',
      hooks: [{ type: 'command', command: 'echo test-hook' }]
    }
  ]
}

vi.mock('../../hooks.service', () => ({
  buildHooksConfig: vi.fn(() => MOCK_HOOKS)
}))

vi.mock('../../plugins.service', () => ({
  listEnabledPlugins: vi.fn(() => [{ installPath: '/enabled/plugin-a' }])
}))

vi.mock('../../config-source-mode.service', () => ({
  getLockedConfigSourceMode: vi.fn(() => 'kite'),
  getLockedUserConfigRootDir: vi.fn(() => '/home/test/.kite')
}))

vi.mock('../../space.service', () => ({
  getSpace: vi.fn(() => null),
  getAllSpacePaths: vi.fn(() => ['/workspace/project', '/workspace/space-b', '/workspace/space-a'])
}))

vi.mock('../../conversation.service', () => ({
  getConversation: vi.fn(() => null)
}))

vi.mock('../../skills-mcp-server', () => ({
  SKILLS_LAZY_SYSTEM_PROMPT: ''
}))

vi.mock('../widget-guidelines', () => ({
  WIDGET_SYSTEM_PROMPT: 'WIDGET_SYSTEM_PROMPT_MOCK',
  createWidgetMcpServer: vi.fn(() => ({ name: 'codepilot-widget-mock' }))
}))

vi.mock('../../plugin-mcp.service', () => ({
  buildPluginMcpServers: vi.fn(() => ({}))
}))

vi.mock('../../../utils/path-validation', () => ({
  isValidDirectoryPath: vi.fn(() => true)
}))

import { getSpaceConfig, updateSpaceConfig } from '../../space-config.service'
import { getConfig } from '../../config.service'
import { buildHooksConfig } from '../../hooks.service'
import { createWidgetMcpServer } from '../widget-guidelines'
import {
  buildPluginsConfig,
  buildSdkOptions,
  buildSettingSources,
  buildSystemPromptAppend,
  getEnabledMcpServers,
  getWorkingDir,
  shouldEnableCodepilotWidgetMcp
} from '../sdk-config.builder'
import { ensureSpaceResourcePolicy, getExecutionLayerAllowedSources } from '../space-resource-policy.service'

function createBuildSdkOptionsParams(workDir: string = '/workspace/project') {
  return {
    spaceId: 'space-1',
    conversationId: 'conversation-1',
    workDir,
    config: {
      api: { provider: 'anthropic' },
      claudeCode: {
        plugins: {
          enabled: true,
          globalPaths: ['/global/plugins'],
          loadDefaultPaths: true
        },
        skillsLazyLoad: false
      }
    },
    abortController: new AbortController(),
    anthropicApiKey: 'test-key',
    anthropicBaseUrl: 'https://api.anthropic.com',
    sdkModel: 'claude-test',
    electronPath: '/usr/bin/electron'
  } as any
}

describe('sdk-config.builder strict space-only', () => {
  it('does not force settingSources to local under strict policy', () => {
    const sources = buildSettingSources('/workspace/project')
    expect(sources).toEqual(['user', 'project'])
  })

  it('keeps global plugin directories available under strict policy', () => {
    const plugins = buildPluginsConfig('/workspace/project')
    const paths = plugins.map(plugin => plugin.path)

    expect(paths).toContain('/enabled/plugin-a')
    expect(paths).toContain('/global/plugins')
    expect(paths).toContain('/home/test/.kite')
    expect(paths).toContain('/workspace/project/.local-plugins')
    expect(paths).toContain('/workspace/project/.claude')
  })

  it('full-mesh 运行时降级后不再聚合其他 space 的 .claude 目录', () => {
    const plugins = buildPluginsConfig('/workspace/project', {
      resourceRuntimePolicy: 'full-mesh'
    })
    const paths = plugins.map(plugin => plugin.path)

    expect(paths).toContain('/workspace/project/.claude')
    expect(paths).not.toContain('/workspace/space-a/.claude')
    expect(paths).not.toContain('/workspace/space-b/.claude')
  })

  it('falls back to legacy behavior when policy is explicitly legacy', () => {
    vi.mocked(getSpaceConfig).mockReturnValue({
      resourcePolicy: {
        version: 1,
        mode: 'legacy'
      },
      claudeCode: {
        plugins: {
          paths: ['.local-plugins']
        }
      }
    } as any)

    const sources = buildSettingSources('/workspace/project')
    const plugins = buildPluginsConfig('/workspace/project')
    const paths = plugins.map(plugin => plugin.path)

    expect(sources).toEqual(['user', 'project'])
    expect(paths).toContain('/enabled/plugin-a')
    expect(paths).toContain('/global/plugins')
    expect(paths).toContain('/home/test/.kite')
    expect(paths).toContain('/workspace/project/.local-plugins')
    expect(paths).toContain('/workspace/project/.claude')
  })

  it('ignores enableSystemSkills and never injects ~/.claude user root', () => {
    vi.mocked(getConfig).mockReturnValue({
      claudeCode: {
        enableSystemSkills: true,
        plugins: {
          enabled: true,
          globalPaths: ['/global/plugins'],
          loadDefaultPaths: true
        },
        skillsLazyLoad: false
      }
    } as any)

    vi.mocked(getSpaceConfig).mockReturnValue({
      resourcePolicy: {
        version: 1,
        mode: 'legacy'
      },
      claudeCode: {
        plugins: {
          paths: []
        }
      }
    } as any)

    const plugins = buildPluginsConfig('/workspace/project')
    const paths = plugins.map(plugin => plugin.path)

    expect(paths).toContain('/home/test/.kite')
    expect(paths).not.toContain('/home/test/.claude')
  })

  it('keeps hooks configurable through buildHooksConfig under strict policy', () => {
    vi.mocked(getSpaceConfig).mockReturnValue({
      resourcePolicy: {
        version: 1,
        mode: 'strict-space-only'
      },
      claudeCode: {
        plugins: {
          paths: ['.local-plugins']
        }
      }
    } as any)

    const sdkOptions = buildSdkOptions(createBuildSdkOptionsParams())

    expect(vi.mocked(buildHooksConfig)).toHaveBeenCalledWith('/workspace/project')
    expect(sdkOptions.hooks).toEqual(MOCK_HOOKS)
  })

  it('preserves explicit legacy resource policy during ensure migration', () => {
    vi.mocked(getSpaceConfig).mockReturnValue({
      resourcePolicy: {
        version: 1,
        mode: 'legacy',
        allowMcp: true
      }
    } as any)

    const policy = ensureSpaceResourcePolicy('/workspace/project')

    expect(policy.mode).toBe('legacy')
    expect(vi.mocked(updateSpaceConfig)).not.toHaveBeenCalled()
  })

  it('keeps execution-layer directive sources available for global and space resources', () => {
    expect(getExecutionLayerAllowedSources()).toEqual(['app', 'global', 'space', 'installed', 'plugin'])
  })

  it('compat 场景会注入 ANTHROPIC_MODEL 与默认模型 env', () => {
    const sdkOptions = buildSdkOptions({
      ...createBuildSdkOptionsParams(),
      useAnthropicCompatModelMapping: true,
      effectiveModel: 'kimi-k2-0905-preview'
    })

    expect(sdkOptions.env.ANTHROPIC_MODEL).toBe('kimi-k2-0905-preview')
    expect(sdkOptions.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('kimi-k2-0905-preview')
    expect(sdkOptions.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('kimi-k2-0905-preview')
    expect(sdkOptions.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('kimi-k2-0905-preview')
  })

  it('默认 native 模式下不注入 disable-slash-commands', () => {
    const sdkOptionsDefault = buildSdkOptions({
      ...createBuildSdkOptionsParams(),
      resourceRuntimePolicy: 'app-single-source'
    })
    const sdkOptionsFullMesh = buildSdkOptions({
      ...createBuildSdkOptionsParams(),
      resourceRuntimePolicy: 'full-mesh'
    })

    expect(sdkOptionsDefault.extraArgs['disable-slash-commands']).toBeUndefined()
    expect(sdkOptionsFullMesh.extraArgs['disable-slash-commands']).toBeUndefined()
  })

  it('默认 native 模式下 allowedTools 包含 Skill（含 full-mesh 运行时降级）', () => {
    const sdkOptionsDefault = buildSdkOptions({
      ...createBuildSdkOptionsParams(),
      resourceRuntimePolicy: 'app-single-source'
    })
    const sdkOptionsFullMesh = buildSdkOptions({
      ...createBuildSdkOptionsParams(),
      resourceRuntimePolicy: 'full-mesh'
    })

    expect(sdkOptionsDefault.allowedTools).toContain('Skill')
    expect(sdkOptionsFullMesh.allowedTools).toContain('Skill')
  })

  it('legacy-inject 模式下注入 disable-slash-commands 且不允许 Skill', () => {
    const sdkOptions = buildSdkOptions({
      ...createBuildSdkOptionsParams(),
      slashRuntimeMode: 'legacy-inject'
    })

    expect(sdkOptions.extraArgs['disable-slash-commands']).toBeNull()
    expect(sdkOptions.allowedTools).not.toContain('Skill')
  })

  it('会过滤不符合 schema 的 MCP 配置，仅保留有效项', () => {
    const enabled = getEnabledMcpServers(
      {
        demo: { env: {} },
        stdioOk: { command: 'node', args: ['server.js'], env: { TOKEN: 'abc', NUM: 1 } },
        httpBad: { type: 'http', headers: { Authorization: 'Bearer x' } },
        sseOk: { type: 'sse', url: 'https://example.com/sse', headers: { Authorization: 'Bearer x', Retry: 3 } },
        disabledServer: { command: 'python', disabled: true }
      } as any,
      '/workspace/project'
    )

    expect(enabled).toEqual({
      stdioOk: { command: 'node', args: ['server.js'], env: { TOKEN: 'abc' } },
      sseOk: { type: 'sse', url: 'https://example.com/sse', headers: { Authorization: 'Bearer x' } }
    })
  })

  it('system prompt append includes blocking-batch AskUserQuestion policy', () => {
    const append = buildSystemPromptAppend('/workspace/project', 'zh-CN')

    expect(append).toContain('execution-blocking gaps')
    expect(append).toContain('higher priority than plain-text clarification')
    expect(append).toContain('at most 3 questions')
    expect(append).toContain('Avoid duplicate question texts and duplicate option labels')
    expect(append).toContain('plain-text clarification is allowed only once per conversation')
    expect(append).toContain('Language policy')
    expect(append).toContain('zh-CN')
    expect(append).not.toContain('Do NOT use resources outside this list.')
  })

  it('buildSdkOptions 默认注入 WIDGET_SYSTEM_PROMPT', () => {
    const sdkOptions = buildSdkOptions(createBuildSdkOptionsParams())
    expect(sdkOptions.systemPrompt.append).toContain('WIDGET_SYSTEM_PROMPT_MOCK')
  })

  it('命中可视化关键词时会按需挂载 codepilot-widget MCP', () => {
    vi.mocked(createWidgetMcpServer).mockClear()

    const sdkOptions = buildSdkOptions({
      ...createBuildSdkOptionsParams(),
      promptForMcpRouting: '请做一个看板和图表小组件'
    })

    expect(vi.mocked(createWidgetMcpServer)).toHaveBeenCalledTimes(1)
    expect(sdkOptions.mcpServers).toEqual(
      expect.objectContaining({
        'codepilot-widget': { name: 'codepilot-widget-mock' }
      })
    )
  })

  it('shouldEnableCodepilotWidgetMcp 支持中英文关键词判定', () => {
    expect(
      shouldEnableCodepilotWidgetMcp({
        prompt: 'please render a dashboard widget for weekly conversion'
      })
    ).toBe(true)
    expect(
      shouldEnableCodepilotWidgetMcp({
        prompt: '帮我做一个可视化时间线'
      })
    ).toBe(true)
    expect(
      shouldEnableCodepilotWidgetMcp({
        prompt: 'just help me rename this variable'
      })
    ).toBe(false)
  })

  it('getWorkingDir throws explicit SPACE_NOT_FOUND_FOR_WORKDIR for missing normal space', () => {
    expect(() => getWorkingDir('missing-space')).toThrow(/missing-space/)

    try {
      getWorkingDir('missing-space')
    } catch (error) {
      const typedError = error as Error & { errorCode?: string }
      expect(typedError.errorCode).toBe('SPACE_NOT_FOUND_FOR_WORKDIR')
    }
  })
})
