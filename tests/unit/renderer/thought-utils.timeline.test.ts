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
})

