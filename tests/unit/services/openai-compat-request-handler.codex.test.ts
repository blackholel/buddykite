import { describe, expect, it } from 'vitest'
import type { AnthropicRequest } from '../../../src/main/openai-compat-router/types'
import { ensureCodexResponsesInstructions } from '../../../src/main/openai-compat-router/server/request-handler'

function createAnthropicRequest(partial: Partial<AnthropicRequest> = {}): AnthropicRequest {
  return {
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    messages: [{ role: 'user', content: 'hello' }],
    ...partial
  }
}

describe('openai-compat.request-handler.codex', () => {
  it('非 codex endpoint 不改写 instructions', () => {
    const request = createAnthropicRequest({
      system: 'sys-instructions'
    })
    const openaiRequest: Record<string, unknown> = {
      model: 'gpt-5-codex',
      input: []
    }

    ensureCodexResponsesInstructions('https://api.openai.com/v1/responses', request, openaiRequest)

    expect(openaiRequest.instructions).toBeUndefined()
    expect(openaiRequest.store).toBeUndefined()
  })

  it('codex endpoint 且已有 instructions 时保持不变', () => {
    const request = createAnthropicRequest({
      system: 'sys-instructions'
    })
    const openaiRequest: Record<string, unknown> = {
      model: 'gpt-5-codex',
      input: [],
      instructions: 'existing'
    }

    ensureCodexResponsesInstructions(
      'https://chatgpt.com/backend-api/codex/responses',
      request,
      openaiRequest
    )

    expect(openaiRequest.instructions).toBe('existing')
    expect(openaiRequest.store).toBe(false)
  })

  it('codex endpoint 且缺失 instructions 时优先使用 system', () => {
    const request = createAnthropicRequest({
      system: 'system: follow rules'
    })
    const openaiRequest: Record<string, unknown> = {
      model: 'gpt-5-codex',
      input: []
    }

    ensureCodexResponsesInstructions(
      'https://chatgpt.com/backend-api/codex/responses',
      request,
      openaiRequest
    )

    expect(openaiRequest.instructions).toBe('system: follow rules')
    expect(openaiRequest.store).toBe(false)
  })

  it('codex endpoint 在无 system 时使用首条 user 文本', () => {
    const request = createAnthropicRequest({
      system: undefined,
      messages: [
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: '请总结这段内容' }
      ]
    })
    const openaiRequest: Record<string, unknown> = {
      model: 'gpt-5-codex',
      input: []
    }

    ensureCodexResponsesInstructions(
      'https://chatgpt.com/backend-api/codex/responses',
      request,
      openaiRequest
    )

    expect(openaiRequest.instructions).toBe('请总结这段内容')
    expect(openaiRequest.store).toBe(false)
  })
})
