import { join } from 'path'
import { getKiteDir } from '../config.service'
import { FileOpenAICodexCredentialStore } from './credential-store'
import { OpenAICodexRefreshCoordinator } from './refresh-coordinator'
import { recordOpenAICodexTelemetry } from './telemetry'
import {
  OPENAI_CODEX_PROVIDER_ID,
  type OpenAICodexCredential,
  type OpenAICodexCredentialStore
} from './types'

type FetchLike = typeof fetch

export interface OpenAICodexTokenRefreshServiceOptions {
  clientId?: string
  tokenUrl?: string
  refreshSkewSec?: number
  fetchImpl?: FetchLike
  credentialStore?: OpenAICodexCredentialStore
  refreshCoordinator?: OpenAICodexRefreshCoordinator
}

export interface EnsureValidAccessTokenInput {
  tenantId: string
  accountId?: string
  fallbackAccessToken?: string
  refreshSkewSec?: number
  requireCredential?: boolean
}

export interface EnsureValidAccessTokenResult {
  accessToken: string
  source: 'credential' | 'fallback'
  refreshState: 'not_needed' | 'performed' | 'invalid_grant' | 'failed' | 'fallback' | 'no_refresh_token'
  tenantId: string
  accountId?: string
}

const OPENAI_AUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const OPENAI_CODEX_DEFAULT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const DEFAULT_REFRESH_SKEW_SEC = 120

async function parseJsonSafely(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text()
  if (!raw) return {}
  return JSON.parse(raw) as Record<string, unknown>
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || undefined
}

function stringifyErrorDetail(value: unknown): string | undefined {
  const direct = asNonEmptyString(value)
  if (direct) {
    return direct
  }

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

function extractErrorCode(errorValue: unknown): string {
  if (typeof errorValue === 'string') {
    return errorValue.trim().toLowerCase()
  }
  if (!errorValue || typeof errorValue !== 'object') {
    return ''
  }

  const record = errorValue as Record<string, unknown>
  const code = asNonEmptyString(record.code)
    || asNonEmptyString(record.error)
    || asNonEmptyString(record.type)
  return (code || '').toLowerCase()
}

function formatOAuthError(payload: Record<string, unknown>, status: number): string {
  const errorText = stringifyErrorDetail(payload.error)
  if (errorText) {
    return errorText
  }

  const fallback = asNonEmptyString(payload.error_description)
    || asNonEmptyString(payload.message)
  if (fallback) {
    return fallback
  }

  return `${status}`
}

function resolveSkewMs(explicit: number | undefined, defaultSec: number): number {
  const sec = explicit && explicit > 0 ? explicit : defaultSec
  return sec * 1000
}

function needsRefresh(credential: OpenAICodexCredential, skewMs: number): boolean {
  if (!credential.expiresAt) return false
  return credential.expiresAt <= Date.now() + skewMs
}

function toExpiresAt(expiresIn: number | undefined, prevExpiresAt?: number): number | undefined {
  if (!expiresIn || expiresIn <= 0) return prevExpiresAt
  return Date.now() + expiresIn * 1000
}

export class OpenAICodexTokenRefreshService {
  private readonly clientId: string
  private readonly tokenUrl: string
  private readonly refreshSkewSec: number
  private readonly fetchImpl: FetchLike
  private readonly credentialStore: OpenAICodexCredentialStore
  private readonly refreshCoordinator: OpenAICodexRefreshCoordinator

  constructor(options: OpenAICodexTokenRefreshServiceOptions = {}) {
    this.clientId = options.clientId || process.env.OPENAI_CODEX_OAUTH_CLIENT_ID || OPENAI_CODEX_DEFAULT_CLIENT_ID
    this.tokenUrl = options.tokenUrl || OPENAI_AUTH_TOKEN_URL
    this.refreshSkewSec = options.refreshSkewSec || DEFAULT_REFRESH_SKEW_SEC
    this.fetchImpl = options.fetchImpl || fetch
    this.credentialStore =
      options.credentialStore ||
      new FileOpenAICodexCredentialStore(join(getKiteDir(), 'auth.json'))
    this.refreshCoordinator = options.refreshCoordinator || new OpenAICodexRefreshCoordinator()
  }

  async ensureValidAccessToken(
    input: EnsureValidAccessTokenInput
  ): Promise<EnsureValidAccessTokenResult> {
    const credential = await this.credentialStore.getActive(
      input.tenantId,
      OPENAI_CODEX_PROVIDER_ID,
      input.accountId
    )

    if (!credential || !credential.accessToken) {
      if (input.requireCredential) {
        throw new Error('No active OpenAI Codex credential found')
      }
      if (input.fallbackAccessToken) {
        recordOpenAICodexTelemetry({
          type: 'token_refresh',
          status: 'fallback',
          accountId: input.accountId
        })
        return {
          accessToken: input.fallbackAccessToken,
          source: 'fallback',
          refreshState: 'fallback',
          tenantId: input.tenantId,
          accountId: input.accountId
        }
      }
      throw new Error('No active OpenAI Codex credential found')
    }

    const skewMs = resolveSkewMs(input.refreshSkewSec, this.refreshSkewSec)
    if (!needsRefresh(credential, skewMs)) {
      recordOpenAICodexTelemetry({
        type: 'token_refresh',
        status: 'not_needed',
        accountId: input.accountId
      })
      return {
        accessToken: credential.accessToken,
        source: 'credential',
        refreshState: 'not_needed',
        tenantId: credential.tenantId,
        accountId: credential.accountId
      }
    }

    if (!credential.refreshToken) {
      if (credential.expiresAt && credential.expiresAt <= Date.now()) {
        recordOpenAICodexTelemetry({
          type: 'token_refresh',
          status: 'failed',
          accountId: credential.accountId
        })
        throw new Error('Token refresh failed: missing refresh_token')
      }
      return {
        accessToken: credential.accessToken,
        source: 'credential',
        refreshState: 'no_refresh_token',
        tenantId: credential.tenantId,
        accountId: credential.accountId
      }
    }

    try {
      const refreshed = await this.refreshCoordinator.run(credential.id, async () =>
        this.refreshCredential(credential)
      )
      return {
        accessToken: refreshed.accessToken || credential.accessToken,
        source: 'credential',
        refreshState: 'performed',
        tenantId: refreshed.tenantId,
        accountId: refreshed.accountId
      }
    } catch (error) {
      const message = `${(error as Error).message || ''}`.toLowerCase()
      if (message.includes('invalid_grant')) {
        return Promise.reject(new Error('Token refresh failed: invalid_grant'))
      }
      return Promise.reject(error)
    }
  }

  private async refreshCredential(credential: OpenAICodexCredential): Promise<OpenAICodexCredential> {
    if (!credential.refreshToken) {
      return credential
    }

    recordOpenAICodexTelemetry({
      type: 'token_refresh',
      status: 'attempted',
      accountId: credential.accountId
    })

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      refresh_token: credential.refreshToken
    })

    const response = await this.fetchImpl(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    })

    const payload = await parseJsonSafely(response)
    if (!response.ok) {
      const errorCode = extractErrorCode(payload.error)
      if (errorCode === 'invalid_grant') {
        await this.credentialStore.markRevoked(credential.id, 'invalid_grant')
        recordOpenAICodexTelemetry({
          type: 'token_refresh',
          status: 'invalid_grant',
          accountId: credential.accountId
        })
      }
      if (errorCode !== 'invalid_grant') {
        recordOpenAICodexTelemetry({
          type: 'token_refresh',
          status: 'failed',
          accountId: credential.accountId
        })
      }
      throw new Error(`Token refresh failed: ${formatOAuthError(payload, response.status)}`)
    }

    const accessToken = `${payload.access_token || ''}`.trim()
    if (!accessToken) {
      throw new Error('Token refresh failed: missing access_token')
    }

    const refreshed: OpenAICodexCredential = {
      ...credential,
      accessToken,
      refreshToken: `${payload.refresh_token || ''}`.trim() || credential.refreshToken,
      tokenType: `${payload.token_type || ''}`.trim() || credential.tokenType,
      scope: `${payload.scope || ''}`.trim() || credential.scope,
      expiresAt: toExpiresAt(
        Number(payload.expires_in || 0),
        credential.expiresAt
      )
    }

    await this.credentialStore.upsert(refreshed)
    recordOpenAICodexTelemetry({
      type: 'token_refresh',
      status: 'success',
      accountId: credential.accountId
    })
    return refreshed
  }
}

let singleton: OpenAICodexTokenRefreshService | null = null

export function getOpenAICodexTokenRefreshService(): OpenAICodexTokenRefreshService {
  if (!singleton) {
    singleton = new OpenAICodexTokenRefreshService()
  }
  return singleton
}

export function _testResetOpenAICodexTokenRefreshService(): void {
  singleton = null
}
