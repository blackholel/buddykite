import { describe, expect, it } from 'vitest'
import type { Message } from '../../../types'
import { deriveChatTurns } from '../chat-navigation-model'

function createMessage(partial: Partial<Message> & Pick<Message, 'id' | 'role' | 'content' | 'timestamp'>): Message {
  return {
    ...partial
  } as Message
}

describe('deriveChatTurns', () => {
  it('正常 user/assistant 配对生成轮次', () => {
    const messages: Message[] = [
      createMessage({ id: 'u-1', role: 'user', content: 'first', timestamp: '2026-05-01T10:00:00.000Z' }),
      createMessage({ id: 'a-1', role: 'assistant', content: 'reply-1', timestamp: '2026-05-01T10:00:01.000Z' }),
      createMessage({ id: 'u-2', role: 'user', content: 'second', timestamp: '2026-05-01T10:00:02.000Z' }),
      createMessage({ id: 'a-2', role: 'assistant', content: 'reply-2', timestamp: '2026-05-01T10:00:03.000Z' })
    ]

    const turns = deriveChatTurns(messages, false, null)

    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({
      index: 1,
      userMessageId: 'u-1',
      assistantMessageId: 'a-1',
      state: 'closed'
    })
    expect(turns[1]).toMatchObject({
      index: 2,
      userMessageId: 'u-2',
      assistantMessageId: 'a-2',
      state: 'closed'
    })
  })

  it('guided user message 不进入主轮次', () => {
    const messages: Message[] = [
      createMessage({ id: 'u-1', role: 'user', content: 'first', timestamp: '2026-05-01T10:00:00.000Z' }),
      createMessage({ id: 'a-1', role: 'assistant', content: 'reply-1', timestamp: '2026-05-01T10:00:01.000Z' }),
      createMessage({
        id: 'u-guided',
        role: 'user',
        content: 'guide current run',
        timestamp: '2026-05-01T10:00:02.000Z',
        guidedMeta: { runId: 'run-1' }
      }),
      createMessage({ id: 'a-placeholder', role: 'assistant', content: '', timestamp: '2026-05-01T10:00:03.000Z' })
    ]

    const turns = deriveChatTurns(messages, true, 'run-1')

    expect(turns).toHaveLength(1)
    expect(turns[0]).toMatchObject({
      userMessageId: 'u-1',
      assistantMessageId: 'a-1'
    })
  })

  it('连续 user 会关闭上一轮，末尾无 assistant 保持 open', () => {
    const messages: Message[] = [
      createMessage({ id: 'u-1', role: 'user', content: 'first', timestamp: '2026-05-01T10:00:00.000Z' }),
      createMessage({ id: 'u-2', role: 'user', content: 'second', timestamp: '2026-05-01T10:00:01.000Z' })
    ]

    const turns = deriveChatTurns(messages, false, null)

    expect(turns).toHaveLength(2)
    expect(turns[0]).toMatchObject({
      userMessageId: 'u-1',
      assistantMessageId: null,
      state: 'closed'
    })
    expect(turns[1]).toMatchObject({
      userMessageId: 'u-2',
      assistantMessageId: null,
      state: 'open'
    })
  })

  it('生成中最后一轮无 assistant 也保留 open 轮次', () => {
    const messages: Message[] = [
      createMessage({ id: 'u-1', role: 'user', content: 'first', timestamp: '2026-05-01T10:00:00.000Z' }),
      createMessage({ id: 'a-1', role: 'assistant', content: 'reply-1', timestamp: '2026-05-01T10:00:01.000Z' }),
      createMessage({ id: 'u-2', role: 'user', content: 'second', timestamp: '2026-05-01T10:00:02.000Z' })
    ]

    const turns = deriveChatTurns(messages, true, 'run-1')

    expect(turns).toHaveLength(2)
    expect(turns[1]).toMatchObject({
      userMessageId: 'u-2',
      assistantMessageId: null,
      state: 'open'
    })
  })
})
