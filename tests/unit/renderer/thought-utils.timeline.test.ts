import { describe, expect, it } from 'vitest'
import type { Thought } from '../../../src/renderer/types'
import { buildTimelineSegments } from '../../../src/renderer/utils/thought-utils'

function now() {
  return new Date().toISOString()
}

describe('thought-utils timeline segments', () => {
  it('treats Agent tool_use as sub-agent segment', () => {
    const thoughts: Thought[] = [
      {
        id: 'agent-1',
        type: 'tool_use',
        content: 'Sub-agent: 分析模块',
        timestamp: now(),
        toolName: 'Agent',
        toolInput: {
          description: '分析项目核心功能模块'
        }
      },
      {
        id: 'child-1',
        type: 'tool_use',
        content: 'Bash ls -la',
        timestamp: now(),
        toolName: 'Bash',
        parentToolUseId: 'agent-1',
        toolInput: { command: 'ls -la' }
      },
      {
        id: 'agent-1',
        type: 'tool_result',
        content: 'done',
        timestamp: now(),
        toolOutput: 'ok'
      }
    ]

    const segments = buildTimelineSegments(thoughts)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      type: 'subagent',
      agentId: 'agent-1',
      description: '分析项目核心功能模块',
      isRunning: false
    })
  })

  it('treats successful Skill tool_use without tool_result as completed skill segment', () => {
    const thoughts: Thought[] = [
      {
        id: 'skill-loaded-1',
        type: 'tool_use',
        content: '已加载技能：gstack:plan-ceo-review',
        timestamp: now(),
        toolName: 'Skill',
        toolInput: {
          skill: 'gstack:plan-ceo-review'
        },
        status: 'success'
      }
    ]

    const segments = buildTimelineSegments(thoughts)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      type: 'skill',
      skillId: 'skill-loaded-1',
      skillName: 'gstack:plan-ceo-review',
      isRunning: false,
      hasError: false
    })
  })

  it('converts legacy system text "已加载技能" into skill segment', () => {
    const thoughts: Thought[] = [
      {
        id: 'legacy-system-1',
        type: 'system',
        content: '已加载技能：gstack:plan-ceo-review',
        timestamp: now()
      }
    ]

    const segments = buildTimelineSegments(thoughts)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      type: 'skill',
      skillName: 'gstack:plan-ceo-review',
      isRunning: false,
      hasError: false,
      sourceThoughtId: 'legacy-system-1'
    })
  })

  it('dedupes synthetic slash_skill_loaded segment when real Skill segment exists', () => {
    const thoughts: Thought[] = [
      {
        id: 'tool-call-1',
        type: 'tool_use',
        content: '/前端幻灯片 把内容转成 HTML',
        timestamp: now(),
        toolName: 'Skill',
        toolInput: {
          skill: 'frontend-slides',
          args: '把内容转成 HTML'
        }
      },
      {
        id: 'tool-call-1',
        type: 'tool_result',
        content: 'Tool execution succeeded',
        timestamp: now(),
        toolOutput: 'Launching skill: frontend-slides'
      },
      {
        id: 'slash-skill-loaded-run-1-1',
        type: 'tool_use',
        content: '已加载技能：frontend-slides',
        timestamp: now(),
        toolName: 'Skill',
        toolInput: {
          skill: 'frontend-slides'
        },
        status: 'success'
      }
    ]

    const segments = buildTimelineSegments(thoughts)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      type: 'skill',
      skillId: 'tool-call-1',
      skillName: 'frontend-slides',
      result: 'Launching skill: frontend-slides'
    })
  })

  it('keeps synthetic slash_skill_loaded segment when no real Skill segment exists', () => {
    const thoughts: Thought[] = [
      {
        id: 'slash-skill-loaded-run-2-1',
        type: 'tool_use',
        content: '已加载技能：knowledge-site-creator',
        timestamp: now(),
        toolName: 'Skill',
        toolInput: {
          skill: 'knowledge-site-creator'
        },
        status: 'success'
      }
    ]

    const segments = buildTimelineSegments(thoughts)
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({
      type: 'skill',
      skillId: 'slash-skill-loaded-run-2-1',
      skillName: 'knowledge-site-creator',
      hasError: false
    })
  })
})
