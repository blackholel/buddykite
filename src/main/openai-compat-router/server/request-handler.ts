/**
 * Request Handler
 *
 * Core logic for handling Anthropic -> OpenAI -> Anthropic conversion.
 * URL is the single source of truth - no inference, no override.
 */

import type { Response as ExpressResponse } from 'express'
import type { AnthropicRequest, BackendConfig } from '../types'
import {
  convertAnthropicToOpenAIChat,
  convertAnthropicToOpenAIResponses,
  convertOpenAIChatToAnthropic,
  convertOpenAIResponsesToAnthropic
} from '../converters'
import {
  streamOpenAIChatToAnthropic,
  streamOpenAIResponsesToAnthropic
} from '../stream'
import { getApiTypeFromUrl, isValidEndpointUrl, getEndpointUrlError, shouldForceStream } from './api-type'
import { withRequestQueue, generateQueueKey } from './request-queue'

export interface RequestHandlerOptions {
  debug?: boolean
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes
const OPENAI_CODEX_BACKEND_HOST = 'chatgpt.com/backend-api/codex'
const DEFAULT_CODEX_INSTRUCTIONS = 'You are ChatGPT Codex. Follow system constraints, then complete the user request using tools when needed.'

function isOpenAICodexBackendUrl(url: string): boolean {
  return url.trim().toLowerCase().includes(OPENAI_CODEX_BACKEND_HOST)
}

function extractSystemInstructionsText(system: AnthropicRequest['system']): string | undefined {
  if (typeof system === 'string') {
    const text = system.trim()
    return text || undefined
  }

  if (!Array.isArray(system)) {
    return undefined
  }

  const text = system
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim()

  return text || undefined
}

function extractFirstUserText(messages: AnthropicRequest['messages']): string | undefined {
  if (!Array.isArray(messages)) return undefined

  for (const message of messages) {
    if (!message || message.role !== 'user') continue
    if (typeof message.content === 'string') {
      const text = message.content.trim()
      if (text) return text
      continue
    }
    if (!Array.isArray(message.content)) continue
    const text = message.content
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text.trim())
      .filter(Boolean)
      .join('\n')
      .trim()
    if (text) return text
  }

  return undefined
}

export function ensureCodexResponsesInstructions(
  backendUrl: string,
  anthropicRequest: AnthropicRequest,
  openaiRequest: Record<string, unknown>
): void {
  if (!isOpenAICodexBackendUrl(backendUrl)) return

  // chatgpt codex backend requires explicit store=false.
  openaiRequest.store = false

  const existingInstructions = typeof openaiRequest.instructions === 'string'
    ? openaiRequest.instructions.trim()
    : ''
  if (existingInstructions) return

  const instructionsFromSystem = extractSystemInstructionsText(anthropicRequest.system)
  if (instructionsFromSystem) {
    openaiRequest.instructions = instructionsFromSystem
    return
  }

  const firstUserText = extractFirstUserText(anthropicRequest.messages)
  if (firstUserText) {
    openaiRequest.instructions = firstUserText.slice(0, 1000)
    return
  }

  openaiRequest.instructions = DEFAULT_CODEX_INSTRUCTIONS
}

function logCodexResponsesRequestShape(backendUrl: string, openaiRequest: Record<string, unknown>): void {
  if (!isOpenAICodexBackendUrl(backendUrl)) return
  const instructions =
    typeof openaiRequest.instructions === 'string' ? openaiRequest.instructions.trim() : ''
  const storeValue = openaiRequest.store
  console.log('[RequestHandler] Codex request normalized:', {
    hasInstructions: Boolean(instructions),
    instructionsLength: instructions.length,
    store: storeValue
  })
}

/**
 * Send error response in Anthropic format
 */
function sendError(
  res: ExpressResponse,
  statusCode: number,
  errorType: string,
  message: string
): void {
  res.status(statusCode).json({
    type: 'error',
    error: { type: errorType, message }
  })
}

/**
 * Make upstream request
 */
async function fetchUpstream(
  targetUrl: string,
  apiKey: string,
  extraHeaders: Record<string, string> | undefined,
  body: unknown,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<globalThis.Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    console.log('[RequestHandler] Request timeout, aborting...')
    controller.abort()
  }, timeoutMs)

  try {
    return await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(extraHeaders || {})
      },
      body: JSON.stringify(body),
      signal: signal ?? controller.signal
    })
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Handle messages request
 */
export async function handleMessagesRequest(
  anthropicRequest: AnthropicRequest,
  config: BackendConfig,
  res: ExpressResponse,
  options: RequestHandlerOptions = {}
): Promise<void> {
  const { debug = false, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const { url: backendUrl, key: apiKey, model, headers } = config

  // Validate URL has valid endpoint suffix
  if (!isValidEndpointUrl(backendUrl)) {
    return sendError(res, 400, 'invalid_request_error', getEndpointUrlError(backendUrl))
  }

  // Get API type from URL suffix (guaranteed non-null after validation)
  const apiType = getApiTypeFromUrl(backendUrl)!

  // Override model if specified in config
  if (model) {
    anthropicRequest.model = model
  }

  if (debug) {
    console.log('[RequestHandler] Backend:', backendUrl)
    console.log('[RequestHandler] API Key:', apiKey.slice(0, 8) + '...')
    console.log('[RequestHandler] ApiType:', apiType)
  }

  // Use request queue to prevent concurrent requests
  const queueKey = generateQueueKey(backendUrl, apiKey)

  await withRequestQueue(queueKey, async () => {
    try {
      // Determine stream mode
      const forceEnvStream = shouldForceStream()
      const preferStreamByWire = apiType === 'responses' && anthropicRequest.stream === undefined
      let wantStream = forceEnvStream || preferStreamByWire || anthropicRequest.stream

      // Convert request
      const requestToSend = { ...anthropicRequest, stream: wantStream }
      const openaiRequest = apiType === 'responses'
        ? convertAnthropicToOpenAIResponses(requestToSend).request
        : convertAnthropicToOpenAIChat(requestToSend).request
      if (apiType === 'responses') {
        ensureCodexResponsesInstructions(
          backendUrl,
          anthropicRequest,
          openaiRequest as unknown as Record<string, unknown>
        )
        logCodexResponsesRequestShape(backendUrl, openaiRequest as unknown as Record<string, unknown>)
      }

      const toolCount = (openaiRequest as any).tools?.length ?? 0
      console.log(`[RequestHandler] wire=${apiType} tools=${toolCount}`)
      console.log(`[RequestHandler] POST ${backendUrl} (stream=${wantStream ?? false})`)

      // Make upstream request - URL is used directly, no modification
      let upstreamResp = await fetchUpstream(backendUrl, apiKey, headers, openaiRequest, timeoutMs)
      console.log(`[RequestHandler] Upstream response: ${upstreamResp.status}`)

      // Handle errors
      if (!upstreamResp.ok) {
        const errorText = await upstreamResp.text().catch(() => '')

        // Rate limit - return immediately
        if (upstreamResp.status === 429) {
          console.error(`[RequestHandler] Provider 429: ${errorText.slice(0, 200)}`)
          return sendError(res, 429, 'rate_limit_error', `Provider error: ${errorText || 'HTTP 429'}`)
        }

        // Check if upstream requires stream=true
        const requiresStream = errorText?.toLowerCase().includes('stream must be set to true')

        if (requiresStream && !wantStream) {
          console.warn('[RequestHandler] Upstream requires stream=true, retrying...')

          // Retry with stream enabled
          wantStream = true
          const retryRequest = apiType === 'responses'
            ? convertAnthropicToOpenAIResponses({ ...anthropicRequest, stream: true }).request
            : convertAnthropicToOpenAIChat({ ...anthropicRequest, stream: true }).request
          if (apiType === 'responses') {
            ensureCodexResponsesInstructions(
              backendUrl,
              anthropicRequest,
              retryRequest as unknown as Record<string, unknown>
            )
            logCodexResponsesRequestShape(backendUrl, retryRequest as unknown as Record<string, unknown>)
          }

          upstreamResp = await fetchUpstream(backendUrl, apiKey, headers, retryRequest, timeoutMs)

          if (!upstreamResp.ok) {
            const retryErrorText = await upstreamResp.text().catch(() => '')
            console.error(`[RequestHandler] Provider error ${upstreamResp.status}: ${retryErrorText.slice(0, 200)}`)
            return sendError(res, upstreamResp.status, 'api_error', `Provider error: ${retryErrorText || `HTTP ${upstreamResp.status}`}`)
          }
        } else {
          console.error(`[RequestHandler] Provider error ${upstreamResp.status}: ${errorText.slice(0, 200)}`)
          return sendError(res, upstreamResp.status, 'api_error', `Provider error: ${errorText || `HTTP ${upstreamResp.status}`}`)
        }
      }

      // Handle streaming response
      if (wantStream) {
        res.setHeader('Content-Type', 'text/event-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.setHeader('Connection', 'keep-alive')

        if (apiType === 'responses') {
          await streamOpenAIResponsesToAnthropic(upstreamResp.body, res, anthropicRequest.model, debug)
        } else {
          await streamOpenAIChatToAnthropic(upstreamResp.body, res, anthropicRequest.model, debug)
        }
        return
      }

      // Handle non-streaming response
      const openaiResponse = await upstreamResp.json()
      const anthropicResponse = apiType === 'responses'
        ? convertOpenAIResponsesToAnthropic(openaiResponse)
        : convertOpenAIChatToAnthropic(openaiResponse, anthropicRequest.model)

      res.json(anthropicResponse)
    } catch (error: any) {
      // Handle abort/timeout
      if (error?.name === 'AbortError') {
        console.error('[RequestHandler] AbortError (timeout or client disconnect)')
        return sendError(res, 504, 'timeout_error', 'Request timed out')
      }

      const cause = error?.cause as
        | { name?: string; code?: string; message?: string }
        | undefined
      if (cause) {
        console.error('[RequestHandler] Internal error cause:', {
          name: cause.name,
          code: cause.code,
          message: cause.message
        })
      }
      console.error('[RequestHandler] Internal error:', error?.message || error)
      return sendError(res, 500, 'internal_error', error?.message || 'Internal error')
    }
  })
}

/**
 * Handle token counting request (simple estimation)
 */
export function handleCountTokensRequest(
  messages: unknown,
  system: unknown
): { input_tokens: number } {
  let count = 0

  // Rough estimation: 4 characters ≈ 1 token
  if (system) {
    count += Math.ceil(JSON.stringify(system).length / 4)
  }
  if (messages) {
    count += Math.ceil(JSON.stringify(messages).length / 4)
  }

  return { input_tokens: count }
}
