import type { OpenAICodexRequest } from './types'

export const OPENAI_CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses'

export interface BuildOpenAICodexRequestInput {
  accessToken: string
  accountId?: string
  body: Record<string, unknown>
  headers?: Record<string, string>
}

export function buildOpenAICodexRequest(input: BuildOpenAICodexRequestInput): OpenAICodexRequest {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.accessToken}`,
    'Content-Type': 'application/json'
  }

  if (input.accountId) {
    headers['ChatGPT-Account-Id'] = input.accountId
  }

  if (input.headers) {
    Object.assign(headers, input.headers)
  }

  return {
    url: OPENAI_CODEX_RESPONSES_URL,
    method: 'POST',
    headers,
    body: input.body
  }
}
