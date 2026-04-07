export const OPENAI_CODEX_PROVIDER_ID = 'openai-codex' as const
export const OPENAI_API_PROVIDER_ID = 'openai-api' as const

export type OpenAIProviderId = typeof OPENAI_CODEX_PROVIDER_ID | typeof OPENAI_API_PROVIDER_ID

export type OpenAIAuthMethod = 'api_key' | 'oauth_browser' | 'oauth_device'

export interface OpenAICodexCredential {
  id: string
  tenantId: string
  providerId: OpenAIProviderId
  authMethod: OpenAIAuthMethod
  accountId?: string
  subject?: string
  accessToken?: string
  refreshToken?: string
  apiKey?: string
  tokenType?: string
  scope?: string
  expiresAt?: number
  revokedAt?: number
  meta?: Record<string, string>
}

export interface OpenAICodexCredentialStore {
  getActive(tenantId: string, providerId: OpenAIProviderId, accountId?: string): Promise<OpenAICodexCredential | null>
  upsert(credential: OpenAICodexCredential): Promise<void>
  markRevoked(credentialId: string, reason: string): Promise<void>
}

export interface OpenAICodexRequest {
  url: string
  method: 'POST'
  headers: Record<string, string>
  body: Record<string, unknown>
}

export interface OpenAICodexOAuthToken {
  accessToken: string
  refreshToken?: string
  tokenType?: string
  expiresIn?: number
  scope?: string
  accountId?: string
  subject?: string
}

export interface OpenAICodexOAuthSession {
  tenantId: string
  state: string
  codeVerifier: string
  redirectUri: string
  scope: string
  accountId?: string
}

export interface OpenAICodexDeviceAuthorization {
  deviceCode: string
  userCode: string
  verificationUri: string
  intervalSec: number
  expiresIn: number
}
