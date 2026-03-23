import { describe, expect, it } from 'vitest'
import type { Message, Thought } from '../../../types'
import { getMessageThoughtsForDisplay, resolveShowWidgetSnapshotCutIndex } from '../MessageList'
import { parseShowWidgetsForStreaming } from '../../../lib/widget-sanitizer'

describe('MessageList thought priority', () => {
  it('prefers persisted message.thoughts when both thoughts and processTrace exist', () => {
    const persistedThoughts: Thought[] = [
      {
        id: 'task-tool-1',
        type: 'tool_use',
        content: 'Sub-agent: run task',
        timestamp: '2026-02-16T10:00:00.000Z',
        toolName: 'Task',
        parentToolUseId: 'parent-1'
      }
    ]

    const message: Message = {
      id: 'msg-1',
      role: 'assistant',
      content: 'done',
      timestamp: '2026-02-16T10:00:10.000Z',
      thoughts: persistedThoughts,
      processTrace: [
        {
          type: 'process',
          kind: 'tool_call',
          ts: '2026-02-16T10:00:00.000Z',
          payload: {
            toolCallId: 'task-tool-1',
            name: 'Task',
            input: { description: 'run task' }
          }
        }
      ]
    }

    const resolved = getMessageThoughtsForDisplay(message)
    expect(resolved).toBe(persistedThoughts)
    expect(resolved[0]?.parentToolUseId).toBe('parent-1')
  })

  it('falls back to processTrace reconstruction when message.thoughts is empty', () => {
    const message: Message = {
      id: 'msg-2',
      role: 'assistant',
      content: 'done',
      timestamp: '2026-02-16T10:00:10.000Z',
      thoughts: [],
      processTrace: [
        {
          type: 'process',
          kind: 'tool_call',
          ts: '2026-02-16T10:00:00.000Z',
          payload: {
            toolCallId: 'read-1',
            name: 'Read',
            input: { file_path: '/tmp/a.ts' }
          }
        }
      ]
    }

    const resolved = getMessageThoughtsForDisplay(message)
    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toMatchObject({
      id: 'read-1',
      type: 'tool_use',
      toolName: 'Read'
    })
  })
})

describe('resolveShowWidgetSnapshotCutIndex', () => {
  it('无 show-widget 围栏时返回 preferredIndex', () => {
    expect(resolveShowWidgetSnapshotCutIndex('hello world', 5)).toBe(5)
  })

  it('preferred 落在未闭合 show-widget 内时返回 null', () => {
    const content = [
      'intro',
      '```show-widget',
      '{"title":"A","widget_code":"<div>in-progress</div>"}'
    ].join('\n')
    const preferred = content.indexOf('in-progress')
    expect(resolveShowWidgetSnapshotCutIndex(content, preferred)).toBeNull()
  })

  it('preferred 落在 show-widget 内但后续闭合时回退到安全边界', () => {
    const content = [
      'intro',
      '```show-widget',
      '{"title":"A","widget_code":"<div>done</div>"}',
      '```',
      'tail'
    ].join('\n')
    const preferred = content.indexOf('done')
    const cut = resolveShowWidgetSnapshotCutIndex(content, preferred)

    expect(cut).not.toBeNull()
    expect((cut as number) > preferred).toBe(true)
    const snapshot = content.slice(0, cut as number)
    const parsed = parseShowWidgetsForStreaming(snapshot)
    expect(parsed.some((segment) => segment.type === 'widget' && segment.isPartial)).toBe(false)
  })

  it('50轮随机回归：安全切点策略不会产生围栏内截断快照', () => {
    const totalRounds = 50

    const rng = (() => {
      let seed = 0x9e3779b1
      return () => {
        seed = (seed + 0x6d2b79f5) | 0
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    })()

    const isUnsafeSnapshot = (snapshot: string): boolean => {
      const segments = parseShowWidgetsForStreaming(snapshot)
      return segments.some((segment) => {
        if (segment.type === 'widget') return segment.isPartial
        return segment.content.includes('```show-widget')
      })
    }

    let unsafeWithNaiveCut = 0
    let unsafeWithSafeCut = 0

    for (let i = 0; i < totalRounds; i += 1) {
      const prefix = `prefix-${i}-${Math.floor(rng() * 1000)}`
      const widgetInner = `<div>${'x'.repeat(40 + Math.floor(rng() * 50))}</div>`
      const hasClosedFence = i % 2 === 0

      const source = hasClosedFence
        ? [
            prefix,
            '```show-widget',
            `{"title":"R-${i}","widget_code":"${widgetInner}"}`,
            '```',
            `tail-${i}`
          ].join('\n')
        : [
            prefix,
            '```show-widget',
            `{"title":"R-${i}","widget_code":"${widgetInner}"}`
          ].join('\n')

      const openIndex = source.indexOf('```show-widget')
      const preferred = openIndex + 24 + Math.floor(rng() * 20)

      const naiveSnapshot = source.slice(0, preferred)
      if (isUnsafeSnapshot(naiveSnapshot)) {
        unsafeWithNaiveCut += 1
      }

      const safeCut = resolveShowWidgetSnapshotCutIndex(source, preferred)
      if (safeCut != null) {
        const safeSnapshot = source.slice(0, safeCut)
        if (isUnsafeSnapshot(safeSnapshot)) {
          unsafeWithSafeCut += 1
        }
      }
    }

    expect(unsafeWithNaiveCut).toBeGreaterThan(0)
    expect(unsafeWithSafeCut).toBe(0)
  })
})
