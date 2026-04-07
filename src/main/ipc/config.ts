/**
 * Config IPC Handlers
 */

import { ipcMain } from 'electron'
import { getConfig, saveConfig, validateApiConnection } from '../services/config.service'
import type { ProviderProtocol } from '../../shared/types/ai-profile'
import {
  getOpenAICodexOAuthService,
  getOpenAICodexTokenRefreshService,
  resolveOpenAICodexFlags
} from '../services/openai-codex'

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
      }
    ) => {
      try {
        const flags = resolveOpenAICodexFlags()
        if (flags.killed && input.authMode !== 'api_key') {
          return { success: false, error: 'openai-codex 通道已熔断，请稍后再试。' }
        }

        const tenantId = input.tenantId.trim()
        if (!tenantId) {
          return { success: false, error: '缺少 Tenant ID，请在设置中填写后重试。' }
        }

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
          return { success: false, error: '缺少 ChatGPT Account ID，请重新连接账号。' }
        }

        return {
          success: true,
          data: {
            status: 'ready',
            tenantId: result.tenantId,
            accountId: resolvedAccountId,
            refreshState: result.refreshState,
            tokenSource: result.source
          }
        }
      } catch (error: unknown) {
        const err = error as Error
        const message = `${err.message || ''}`.toLowerCase()
        if (message.includes('invalid_grant') || message.includes('no active openai codex credential found')) {
          return { success: false, error: 'ChatGPT 授权失效，请在设置中重新连接账号。' }
        }
        return { success: false, error: err.message }
      }
    }
  )
}
