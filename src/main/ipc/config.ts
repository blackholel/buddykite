/**
 * Config IPC Handlers
 */

import { ipcMain } from 'electron'
import { getConfig, saveConfig, validateApiConnection } from '../services/config.service'
import type { ProviderProtocol } from '../../shared/types/ai-profile'
import {
  getOpenAICodexOAuthService,
  getOpenAICodexTokenRefreshService,
  OPENAI_CODEX_RESPONSES_URL,
  resolveOpenAICodexFlags
} from '../services/openai-codex'

type OpenAICodexValidationErrorCode =
  | 'oauth_exchange_error'
  | 'refresh_error'
  | 'model_not_allowed'
  | 'session_not_found'

interface OpenAICodexModelProbeResult {
  ok: boolean
  modelId: string
  status: number
  message: string
  errorCode?: OpenAICodexValidationErrorCode
}

function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function stringifyUnknown(value: unknown): string | undefined {
  const text = asText(value)
  if (text) return text
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${value}`
  }
  if (!value || typeof value !== 'object') {
    return undefined
  }
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function extractPayloadMessage(payload: Record<string, unknown>): string | undefined {
  return stringifyUnknown(payload.error)
    || asText(payload.error_description)
    || asText(payload.message)
}

function looksLikeModelNotAllowed(message: string): boolean {
  const lower = message.toLowerCase()
  if (!lower.includes('model')) return false
  return (
    lower.includes('not found') ||
    lower.includes('does not exist') ||
    lower.includes('unsupported') ||
    lower.includes('not allowed') ||
    lower.includes('permission') ||
    lower.includes('invalid')
  )
}

async function probeOpenAICodexModelAccess(input: {
  accessToken: string
  accountId?: string
  modelId: string
}): Promise<OpenAICodexModelProbeResult> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.accessToken}`,
    'Content-Type': 'application/json'
  }
  if (input.accountId) {
    headers['ChatGPT-Account-Id'] = input.accountId
  }

  const response = await fetch(OPENAI_CODEX_RESPONSES_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: input.modelId,
      input: 'ping',
      max_output_tokens: 1
    })
  })

  if (response.ok || response.status === 429) {
    return {
      ok: true,
      modelId: input.modelId,
      status: response.status,
      message: response.status === 429
        ? '模型探测命中限流，视为模型可用。'
        : '模型探测通过。'
    }
  }

  const raw = await response.text().catch(() => '')
  let message = raw.trim()
  if (!message) {
    message = `HTTP ${response.status}`
  } else {
    try {
      const parsed = JSON.parse(message) as Record<string, unknown>
      message = extractPayloadMessage(parsed) || message
    } catch {
      // Keep raw text
    }
  }

  if (response.status === 401) {
    return {
      ok: false,
      modelId: input.modelId,
      status: response.status,
      message,
      errorCode: 'refresh_error'
    }
  }

  if (response.status === 403 && looksLikeModelNotAllowed(message)) {
    return {
      ok: false,
      modelId: input.modelId,
      status: response.status,
      message,
      errorCode: 'model_not_allowed'
    }
  }

  if (response.status === 403) {
    return {
      ok: false,
      modelId: input.modelId,
      status: response.status,
      message,
      errorCode: 'refresh_error'
    }
  }

  return {
    ok: false,
    modelId: input.modelId,
    status: response.status,
    message,
    errorCode: 'oauth_exchange_error'
  }
}

function toValidationErrorPayload(error: Error): {
  error: string
  errorCode: OpenAICodexValidationErrorCode
} {
  const message = `${error.message || ''}`
  const lower = message.toLowerCase()
  if (lower.includes('no active openai codex credential found')) {
    return {
      error: 'ChatGPT 授权不存在或已失效，请重新连接账号。',
      errorCode: 'session_not_found'
    }
  }
  if (lower.includes('invalid_grant') || lower.includes('token refresh failed')) {
    return {
      error: 'ChatGPT 授权刷新失败，请重新连接账号。',
      errorCode: 'refresh_error'
    }
  }
  if (looksLikeModelNotAllowed(message)) {
    return {
      error: '当前账号无权使用该模型，请切换模型或账号后重试。',
      errorCode: 'model_not_allowed'
    }
  }
  return {
    error: message || 'ChatGPT 授权校验失败，请稍后再试。',
    errorCode: 'oauth_exchange_error'
  }
}

export function registerConfigHandlers(): void {
  const openAICodexOAuthService = getOpenAICodexOAuthService()
  const openAICodexTokenRefreshService = getOpenAICodexTokenRefreshService()

  // Get configuration
  ipcMain.handle('config:get', async () => {
    try {
      const config = getConfig()
      return { success: true, data: config }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Save configuration
  ipcMain.handle('config:set', async (_event, updates: Record<string, unknown>) => {
    try {
      const config = saveConfig(updates)
      return { success: true, data: config }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  // Validate API connection
  ipcMain.handle(
    'config:validate-api',
    async (
      _event,
      apiKey: string,
      apiUrl: string,
      provider: string,
      protocol?: ProviderProtocol,
      model?: string
    ) => {
      try {
        const result = await validateApiConnection(apiKey, apiUrl, provider, protocol, model)
        return { success: true, data: result }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  ipcMain.handle(
    'config:openai-codex:start-browser-auth',
    async (
      _event,
      input: {
        tenantId: string
        redirectUri?: string
        scope?: string
        accountId?: string
      }
    ) => {
      try {
        const data = await openAICodexOAuthService.startBrowserAuth(input)
        return { success: true, data }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  ipcMain.handle(
    'config:openai-codex:finish-browser-auth',
    async (
      _event,
      input: {
        state: string
        code: string
      }
    ) => {
      try {
        const data = await openAICodexOAuthService.finishBrowserAuth(input)
        return { success: true, data }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  ipcMain.handle(
    'config:openai-codex:start-device-auth',
    async (
      _event,
      input: {
        tenantId: string
        scope?: string
        accountId?: string
      }
    ) => {
      try {
        const data = await openAICodexOAuthService.startDeviceAuth(input)
        return { success: true, data }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  ipcMain.handle(
    'config:openai-codex:poll-device-auth',
    async (
      _event,
      input: {
        deviceCode: string
      }
    ) => {
      try {
        const data = await openAICodexOAuthService.pollDeviceAuth(input)
        return { success: true, data }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  ipcMain.handle(
    'config:openai-codex:validate-session',
    async (
      _event,
      input: {
        tenantId: string
        accountId?: string
        fallbackAccessToken?: string
        authMode?: 'api_key' | 'oauth_browser' | 'oauth_device'
        modelId?: string
      }
    ) => {
      try {
        const flags = resolveOpenAICodexFlags()
        if (flags.killed && input.authMode !== 'api_key') {
          return {
            success: false,
            error: 'openai-codex 通道已熔断，请稍后再试。',
            errorCode: 'oauth_exchange_error' as const
          }
        }

        const tenantId = input.tenantId.trim()
        if (!tenantId) {
          return {
            success: false,
            error: '缺少 Tenant ID，请在设置中填写后重试。',
            errorCode: 'oauth_exchange_error' as const
          }
        }

        const modelId = input.modelId?.trim() || 'gpt-5-codex'
        const accountId = input.accountId?.trim() || undefined
        const result = await openAICodexTokenRefreshService.ensureValidAccessToken({
          tenantId,
          accountId,
          fallbackAccessToken: input.authMode === 'api_key'
            ? input.fallbackAccessToken?.trim() || undefined
            : undefined,
          requireCredential: input.authMode !== 'api_key'
        })
        const resolvedAccountId = accountId || result.accountId
        if (input.authMode !== 'api_key' && !resolvedAccountId) {
          return {
            success: false,
            error: '缺少 ChatGPT Account ID，请重新连接账号。',
            errorCode: 'session_not_found' as const
          }
        }

        const modelProbe = input.authMode === 'api_key'
          ? {
              ok: true,
              modelId,
              status: 0,
              message: 'API Key 模式跳过模型探测。'
            }
          : await probeOpenAICodexModelAccess({
              accessToken: result.accessToken,
              accountId: resolvedAccountId,
              modelId
            })

        if (!modelProbe.ok) {
          return {
            success: false,
            error: modelProbe.message,
            errorCode: modelProbe.errorCode || 'oauth_exchange_error',
            data: {
              status: 'not_ready',
              sessionReady: true,
              tenantId: result.tenantId,
              accountId: resolvedAccountId,
              refreshState: result.refreshState,
              tokenSource: result.source,
              modelProbe
            }
          }
        }

        return {
          success: true,
          data: {
            status: 'ready',
            sessionReady: true,
            tenantId: result.tenantId,
            accountId: resolvedAccountId,
            refreshState: result.refreshState,
            tokenSource: result.source,
            modelProbe
          }
        }
      } catch (error: unknown) {
        const err = error as Error
        const payload = toValidationErrorPayload(err)
        return {
          success: false,
          error: payload.error,
          errorCode: payload.errorCode
        }
      }
    }
  )
}
