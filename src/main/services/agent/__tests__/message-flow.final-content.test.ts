import { describe, expect, it, vi } from 'vitest'
import {
  _testExtractSkillDirectiveTokens,
  _testResolveExplicitSkillDirectives,
  buildLoadedSkillMessage,
  buildConversationHistoryBootstrap,
  buildForcedAssumptionResponse,
  extractLoadedSkillNameFromToolInput,
  normalizeSlashCommands,
  shouldEmitSlashSkillLoadedEvent,
  resolveFinalContent
} from '../message-flow.service'

describe('resolveFinalContent priority', () => {
  it('prefers result content first', () => {
    const content = resolveFinalContent({
      resultContent: 'from-result',
      latestAssistantContent: 'from-session',
      accumulatedTextContent: 'from-accumulated',
      currentStreamingText: 'from-stream'
    })

    expect(content).toBe('from-result')
  })

  it('falls back to latest assistant content when result is empty', () => {
    const content = resolveFinalContent({
      resultContent: '   ',
      latestAssistantContent: 'from-session',
      accumulatedTextContent: 'from-accumulated',
      currentStreamingText: 'from-stream'
    })

    expect(content).toBe('from-session')
  })

  it('uses accumulated + current streaming text as terminal fallback', () => {
    const content = resolveFinalContent({
      accumulatedTextContent: 'chunk-1',
      currentStreamingText: 'chunk-2'
    })

    expect(content).toBe('chunk-1\n\nchunk-2')
  })
})

describe('buildForcedAssumptionResponse', () => {
  it('uses Chinese content when response language is zh-CN', () => {
    const content = buildForcedAssumptionResponse('plan', 'zh-CN')

    expect(content).toContain('澄清预算已用尽')
    expect(content).toContain('## 默认假设下的计划')
  })

  it('uses English content when response language is en', () => {
    const content = buildForcedAssumptionResponse('code', 'en')

    expect(content).toContain('Clarification budget is exhausted')
    expect(content).toContain('## Default Assumption Execution')
  })
})

describe('buildConversationHistoryBootstrap', () => {
  it('当单个 turn 超过预算时，不应强制塞入 fallback turn', () => {
    const result = buildConversationHistoryBootstrap({
      historyMessages: [
        {
          role: 'user',
          content: 'x'.repeat(30000),
          images: [{ type: 'image', data: 'y'.repeat(20000) }]
        }
      ],
      maxBootstrapTokens: 10
    })

    expect(result.block).toBe('')
    expect(result.tokenEstimate).toBe(0)
    expect(result.appliedTurnCount).toBe(0)
  })
})

describe('normalizeSlashCommands', () => {
  it('兼容 string[] 并补全斜杠、去重', () => {
    const normalized = normalizeSlashCommands(['test', '/TEST', '  status  ', '', 'status'])
    expect(normalized).toEqual(['/test', '/status'])
  })

  it('兼容对象数组并优先读取 command/name/id 字段', () => {
    const normalized = normalizeSlashCommands([
      { command: 'alpha' },
      { name: '/beta' },
      { id: 'gamma' },
      { command: 'ALPHA' },
      {}
    ])
    expect(normalized).toEqual(['/alpha', '/beta', '/gamma'])
  })

  it('非数组输入返回空列表', () => {
    expect(normalizeSlashCommands(null)).toEqual([])
    expect(normalizeSlashCommands({})).toEqual([])
    expect(normalizeSlashCommands('not-array')).toEqual([])
  })
})

describe('extractLoadedSkillNameFromToolInput', () => {
  it('优先读取直传字段并去掉开头斜杠', () => {
    expect(extractLoadedSkillNameFromToolInput({ command: '/gstack:plan-ceo-review' })).toBe('gstack:plan-ceo-review')
    expect(extractLoadedSkillNameFromToolInput({ skillName: 'superpowers:writing-plans' })).toBe('superpowers:writing-plans')
  })

  it('兼容 nested skill 对象', () => {
    expect(extractLoadedSkillNameFromToolInput({ skill: { name: '/gstack:qa' } })).toBe('gstack:qa')
  })

  it('无可用字段返回 null', () => {
    expect(extractLoadedSkillNameFromToolInput({})).toBeNull()
    expect(extractLoadedSkillNameFromToolInput(null)).toBeNull()
  })
})

describe('buildLoadedSkillMessage', () => {
  it('生成用户可见的技能加载提示', () => {
    expect(buildLoadedSkillMessage(['gstack:plan-ceo-review'])).toBe('已加载技能：gstack:plan-ceo-review')
    expect(buildLoadedSkillMessage(['a', 'b'])).toBe('已加载技能：a、b')
  })
})

describe('shouldEmitSlashSkillLoadedEvent', () => {
  it('native 模式下不发 slash_skill_loaded（即使 source 是 native）', () => {
    expect(shouldEmitSlashSkillLoadedEvent('native', 'native')).toBe(false)
  })

  it('legacy-inject 模式仅允许 legacy source 发 slash_skill_loaded', () => {
    expect(shouldEmitSlashSkillLoadedEvent('legacy-inject', 'legacy')).toBe(true)
    expect(shouldEmitSlashSkillLoadedEvent('legacy-inject', 'native')).toBe(false)
  })
})

describe('_testExtractSkillDirectiveTokens', () => {
  it('只解析行首 slash 指令，不解析行内 /token', () => {
    const input = [
      '请用 /skill-creator 帮我创建技能',
      '/skill-creator 创建一个技能'
    ].join('\n')
    expect(_testExtractSkillDirectiveTokens(input)).toEqual(['skill-creator'])
  })

  it('忽略 /_ 这类无字母数字的误触发片段', () => {
    expect(_testExtractSkillDirectiveTokens('/_')).toEqual([])
  })
})

describe('_testResolveExplicitSkillDirectives', () => {
  it('无 slash 指令时快速返回，不触发 skills 扫描与解析', () => {
    const deps = {
      listSkillsFn: vi.fn(() => []),
      resolveSkillDefinitionFn: vi.fn()
    }

    const result = _testResolveExplicitSkillDirectives(
      {
        message: '请帮我总结一下这段代码',
        workDir: '/workspace/project',
        locale: 'zh-CN',
        allowedSources: ['app', 'global', 'space']
      },
      deps as any
    )

    expect(result).toEqual({
      explicitDirectives: [],
      resolved: [],
      missing: [],
      ambiguities: [],
      sourceCandidates: ['app', 'global', 'space']
    })
    expect(deps.listSkillsFn).not.toHaveBeenCalled()
    expect(deps.resolveSkillDefinitionFn).not.toHaveBeenCalled()
  })

  it('有显式 slash 指令且未命中时仍返回 missing（保持 fast-fail 语义）', () => {
    const deps = {
      listSkillsFn: vi.fn(() => []),
      resolveSkillDefinitionFn: vi.fn(() => ({ skill: null, ambiguous: [], matchedBy: null }))
    }

    const result = _testResolveExplicitSkillDirectives(
      {
        message: '/skill-creator 帮我创建技能',
        workDir: '/workspace/project',
        locale: 'zh-CN',
        allowedSources: ['app', 'global', 'space']
      },
      deps as any
    )

    expect(result.explicitDirectives).toEqual(['skill-creator'])
    expect(result.missing).toHaveLength(1)
    expect(result.missing[0]?.token).toBe('skill-creator')
    expect(result.ambiguities).toEqual([])
    expect(deps.listSkillsFn).toHaveBeenCalledTimes(1)
    expect(deps.resolveSkillDefinitionFn).toHaveBeenCalledTimes(1)
  })

  it('missing 候选建议不应使用 localized displayName', () => {
    const deps = {
      listSkillsFn: vi.fn(() => [
        {
          name: 'brainstorming',
          source: 'app',
          displayNameBase: 'Brainstorming',
          displayNameLocalized: '头脑风暴'
        }
      ]),
      resolveSkillDefinitionFn: vi.fn(() => ({ skill: null, ambiguous: [], matchedBy: null }))
    }

    const result = _testResolveExplicitSkillDirectives(
      {
        message: '/头脑风暴 帮我做方案',
        workDir: '/workspace/project',
        locale: 'zh-CN',
        allowedSources: ['app', 'global', 'space']
      },
      deps as any
    )

    expect(result.missing).toHaveLength(1)
    expect(result.missing[0]?.token).toBe('头脑风暴')
    expect(result.missing[0]?.candidates).toEqual([])
  })
})
