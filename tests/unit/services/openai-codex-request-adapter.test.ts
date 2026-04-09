import { describe, expect, it } from 'vitest'

import { buildOpenAICodexRequest } from '../../../src/main/services/openai-codex/request-adapter'

describe('openai-codex.request-adapter', () => {
  it('构造 chatgpt backend-api 请求并注入鉴权头', () => {
    const request = buildOpenAICodexRequest({
      accessToken: 'access-token',
      accountId: 'acct-123',
      body: { model: 'gpt-5-codex', input: 'hello' }
    })

    expect(request.url).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(request.method).toBe('POST')
    expect(request.headers.Authorization).toBe('Bearer access-token')
    expect(request.headers['ChatGPT-Account-Id']).toBe('acct-123')
    expect(request.headers['Content-Type']).toBe('application/json')
    expect(request.body).toEqual({ model: 'gpt-5-codex', input: 'hello' })
  })

  it('未提供 accountId 时不注入 ChatGPT-Account-Id', () => {
    const request = buildOpenAICodexRequest({
      accessToken: 'access-token',
      body: { model: 'gpt-5-codex', input: 'hello' }
    })

    expect(request.headers['ChatGPT-Account-Id']).toBeUndefined()
  })

  it('允许调用侧追加自定义 headers', () => {
    const request = buildOpenAICodexRequest({
      accessToken: 'access-token',
      body: { model: 'gpt-5-codex', input: 'hello' },
      headers: {
        'X-Request-Id': 'req-1'
      }
    })

    expect(request.headers['X-Request-Id']).toBe('req-1')
    expect(request.headers.Authorization).toBe('Bearer access-token')
  })
})
