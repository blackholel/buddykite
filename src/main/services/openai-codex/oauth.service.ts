import { randomUUID } from 'crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { join } from 'path'
import { getKiteDir } from '../config.service'
import { FileOpenAICodexCredentialStore } from './credential-store'
import { generateOAuthState, generatePkcePair } from './pkce'
import {
  OPENAI_CODEX_PROVIDER_ID,
  type OpenAICodexCredential,
  type OpenAICodexCredentialStore,
  type OpenAICodexDeviceAuthorization,
  type OpenAICodexOAuthSession,
  type OpenAICodexOAuthToken
} from './types'

const OPENAI_CODEX_DEFAULT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_AUTH_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const OPENAI_AUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const OPENAI_DEVICE_AUTH_URL = 'https://auth.openai.com/api/accounts/deviceauth/usercode'
const OPENAI_DEVICE_TOKEN_URL = 'https://auth.openai.com/api/accounts/deviceauth/token'
const BROWSER_SESSION_TTL_MS = 15 * 60 * 1000
const BROWSER_CALLBACK_TTL_MS = 10 * 60 * 1000
const BROWSER_COMPLETION_TTL_MS = 10 * 60 * 1000
const DEVICE_SESSION_GRACE_MS = 60 * 1000
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000

type FetchLike = typeof fetch

interface DeviceSession {
  tenantId: string
  accountId?: string
  scope: string
  userCode?: string
  flowType: 'device_code' | 'device_auth_id'
}

interface BrowserSessionEntry {
  session: OpenAICodexOAuthSession
  expiresAt: number
}

interface BrowserCallbackEntry {
  result: BrowserCallbackResult
  expiresAt: number
}

interface BrowserCompletionEntry {
  result: BrowserAuthCompletionResult
  expiresAt: number
}

interface DeviceSessionEntry {
  session: DeviceSession
  expiresAt: number
}

interface BrowserCallbackResult {
  state: string
  code?: string
  error?: string
  errorDescription?: string
}

interface BrowserAuthCompletionResult {
  credential: OpenAICodexCredential
  token: OpenAICodexOAuthToken
}

export interface OpenAICodexOAuthServiceOptions {
  clientId?: string
  callbackPort?: number
  authorizeUrl?: string
  tokenUrl?: string
  deviceAuthorizeUrl?: string
  deviceTokenUrl?: string
  enableLocalCallbackServer?: boolean
  fetchImpl?: FetchLike
  credentialStore?: OpenAICodexCredentialStore
}

export interface StartBrowserAuthInput {
  tenantId: string
  redirectUri?: string
  scope?: string
  accountId?: string
}

export interface FinishBrowserAuthInput {
  state: string
  code: string
}

export interface StartDeviceAuthInput {
  tenantId: string
  scope?: string
  accountId?: string
}

export interface PollDeviceAuthInput {
  deviceCode: string
}

type PollDeviceAuthResult =
  | { status: 'pending' }
  | { status: 'authorized'; credential: OpenAICodexCredential; token: OpenAICodexOAuthToken }

function getDefaultRedirectUri(callbackPort: number): string {
  return `http://localhost:${callbackPort}/auth/callback`
}

function normalizeScope(value: string | undefined): string {
  return value?.trim() || 'openid profile email offline_access'
}

function toExpiresAt(expiresIn: number | undefined): number | undefined {
  if (!expiresIn || expiresIn <= 0) return undefined
  return Date.now() + expiresIn * 1000
}

async function parseJsonSafely(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text()
  if (!raw) return {}
  return JSON.parse(raw) as Record<string, unknown>
}

function isAuthorizationPending(payload: Record<string, unknown>): boolean {
  const error = `${payload.error || ''}`.toLowerCase()
  return error === 'authorization_pending' || error === 'slow_down'
}

const CALLBACK_SUCCESS_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Authorization Successful</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; padding: 24px;">
    <h2>Authorization Successful</h2>
    <p>You can return to buddykite now.</p>
  </body>
</html>`

function callbackErrorHtml(message: string): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Authorization Failed</title>
  </head>
  <body style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif; padding: 24px;">
    <h2>Authorization Failed</h2>
    <p>${message}</p>
  </body>
</html>`
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractAccountIdFromClaims(claims: Record<string, unknown> | null): string | undefined {
  if (!claims) return undefined
  const direct = `${claims.chatgpt_account_id || ''}`.trim()
  if (direct) return direct

  const apiAuth = claims['https://api.openai.com/auth']
  if (apiAuth && typeof apiAuth === 'object') {
    const nested = `${(apiAuth as Record<string, unknown>).chatgpt_account_id || ''}`.trim()
    if (nested) return nested
  }

  const organizations = claims.organizations
  if (Array.isArray(organizations) && organizations.length > 0) {
    const first = organizations[0]
    if (first && typeof first === 'object') {
      const orgId = `${(first as Record<string, unknown>).id || ''}`.trim()
      if (orgId) return orgId
    }
  }

  return undefined
}

export class OpenAICodexOAuthService {
  private readonly fetchImpl: FetchLike
  private readonly clientId: string
  private readonly authorizeUrl: string
  private readonly tokenUrl: string
  private readonly deviceAuthorizeUrl: string
  private readonly deviceTokenUrl: string
  private readonly callbackPort: number
  private readonly enableLocalCallbackServer: boolean
  private readonly credentialStore: OpenAICodexCredentialStore
  private readonly browserSessions = new Map<string, BrowserSessionEntry>()
  private readonly browserCallbackResults = new Map<string, BrowserCallbackEntry>()
  private readonly browserCompletedResults = new Map<string, BrowserCompletionEntry>()
  private readonly browserCompletionPromises = new Map<string, Promise<BrowserAuthCompletionResult>>()
  private readonly deviceSessions = new Map<string, DeviceSessionEntry>()
  private callbackServer: Server | null = null
  private readonly cleanupTimer: NodeJS.Timeout

  constructor(options: OpenAICodexOAuthServiceOptions = {}) {
    this.fetchImpl = options.fetchImpl || fetch
    this.clientId = options.clientId || process.env.OPENAI_CODEX_OAUTH_CLIENT_ID || OPENAI_CODEX_DEFAULT_CLIENT_ID
    this.callbackPort = options.callbackPort || Number(process.env.OAUTH_CALLBACK_PORT || 1455)
    this.enableLocalCallbackServer = options.enableLocalCallbackServer ?? (process.env.NODE_ENV !== 'test')
    this.authorizeUrl = options.authorizeUrl || OPENAI_AUTH_AUTHORIZE_URL
    this.tokenUrl = options.tokenUrl || OPENAI_AUTH_TOKEN_URL
    this.deviceAuthorizeUrl = options.deviceAuthorizeUrl || OPENAI_DEVICE_AUTH_URL
    this.deviceTokenUrl = options.deviceTokenUrl || OPENAI_DEVICE_TOKEN_URL
    this.credentialStore =
      options.credentialStore ||
      new FileOpenAICodexCredentialStore(join(getKiteDir(), 'auth.json'))
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredSessions()
    }, SESSION_CLEANUP_INTERVAL_MS)
    this.cleanupTimer.unref?.()
  }

  private cleanupExpiredSessions(now = Date.now()): void {
    for (const [state, entry] of this.browserSessions) {
      if (entry.expiresAt <= now) {
        this.browserSessions.delete(state)
        this.browserCallbackResults.delete(state)
        this.browserCompletedResults.delete(state)
        this.browserCompletionPromises.delete(state)
      }
    }

    for (const [state, entry] of this.browserCallbackResults) {
      if (entry.expiresAt <= now) {
        this.browserCallbackResults.delete(state)
      }
    }

    for (const [state, entry] of this.browserCompletedResults) {
      if (entry.expiresAt <= now) {
        this.browserCompletedResults.delete(state)
      }
    }

    for (const [deviceCode, entry] of this.deviceSessions) {
      if (entry.expiresAt <= now) {
        this.deviceSessions.delete(deviceCode)
      }
    }
  }

  private runSessionCleanup(): void {
    this.cleanupExpiredSessions()
  }

  async startBrowserAuth(input: StartBrowserAuthInput): Promise<{
    authUrl: string
    state: string
    redirectUri: string
  }> {
    this.runSessionCleanup()
    if (this.enableLocalCallbackServer) {
      await this.ensureCallbackServer()
    }

    const redirectUri = input.redirectUri || getDefaultRedirectUri(this.callbackPort)
    const scope = normalizeScope(input.scope)
    const state = generateOAuthState()
    const { codeVerifier, codeChallenge } = generatePkcePair()

    this.browserSessions.set(state, {
      session: {
        tenantId: input.tenantId,
        state,
        codeVerifier,
        redirectUri,
        scope,
        accountId: input.accountId
      },
      expiresAt: Date.now() + BROWSER_SESSION_TTL_MS
    })

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: 'buddykite',
      state
    })

    return {
      authUrl: `${this.authorizeUrl}?${params.toString()}`,
      state,
      redirectUri
    }
  }

  async finishBrowserAuth(input: FinishBrowserAuthInput): Promise<{
    credential: OpenAICodexCredential
    token: OpenAICodexOAuthToken
  }> {
    this.runSessionCleanup()
    const completedEntry = this.browserCompletedResults.get(input.state)
    if (completedEntry) {
      this.browserCompletedResults.delete(input.state)
      return completedEntry.result
    }

    const sessionEntry = this.browserSessions.get(input.state)
    if (!sessionEntry || sessionEntry.expiresAt <= Date.now()) {
      this.browserSessions.delete(input.state)
      this.browserCallbackResults.delete(input.state)
      this.browserCompletedResults.delete(input.state)
      throw new Error('OAuth session expired. Restart authorization and try again.')
    }
    const session = sessionEntry.session

    let authorizationCode = input.code.trim()
    if (!authorizationCode) {
      const callbackEntry = this.browserCallbackResults.get(input.state)
      if (!callbackEntry || callbackEntry.expiresAt <= Date.now()) {
        this.browserCallbackResults.delete(input.state)
        throw new Error('OAuth callback not received yet. Keep browser open or paste callback URL manually.')
      }
      const callback = callbackEntry.result
      this.browserCallbackResults.delete(input.state)
      if (callback.error) {
        throw new Error(`OAuth callback failed: ${callback.errorDescription || callback.error}`)
      }
      authorizationCode = `${callback.code || ''}`.trim()
      if (!authorizationCode) {
        throw new Error('OAuth callback missing authorization code')
      }
    }

    return this.completeBrowserSession(input.state, session, authorizationCode)
  }

  private completeBrowserSession(
    state: string,
    session: OpenAICodexOAuthSession,
    authorizationCode: string
  ): Promise<BrowserAuthCompletionResult> {
    const existing = this.browserCompletionPromises.get(state)
    if (existing) {
      return existing
    }

    const promise = (async () => {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: this.clientId,
        code: authorizationCode,
        redirect_uri: session.redirectUri,
        code_verifier: session.codeVerifier
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
        throw new Error(`OAuth token exchange failed: ${payload.error || response.status}`)
      }

      const token = this.toOAuthToken(payload)
      const credential = await this.upsertCredential({
        tenantId: session.tenantId,
        accountId: session.accountId || token.accountId,
        token,
        authMethod: 'oauth_browser'
      })
      this.browserSessions.delete(state)
      this.browserCallbackResults.delete(state)

      return {
        credential,
        token
      }
    })().finally(() => {
      this.browserCompletionPromises.delete(state)
    })

    this.browserCompletionPromises.set(state, promise)
    return promise
  }

  private async tryAutoCompleteBrowserAuth(state: string, code: string): Promise<void> {
    if (!state || !code) return
    if (this.browserCompletedResults.has(state)) return
    const sessionEntry = this.browserSessions.get(state)
    if (!sessionEntry || sessionEntry.expiresAt <= Date.now()) return

    try {
      const completed = await this.completeBrowserSession(state, sessionEntry.session, code)
      this.browserCompletedResults.set(state, {
        result: completed,
        expiresAt: Date.now() + BROWSER_COMPLETION_TTL_MS
      })
    } catch {
      // Keep session/callback for manual retry.
    }
  }

  private async ensureCallbackServer(): Promise<void> {
    if (this.callbackServer) return

    this.callbackServer = createServer((req, res) => {
      this.handleCallbackRequest(req, res)
    })

    await new Promise<void>((resolve, reject) => {
      const server = this.callbackServer
      if (!server) {
        reject(new Error('OAuth callback server init failed'))
        return
      }

      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }

      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(this.callbackPort)
    })
  }

  private handleCallbackRequest(req: IncomingMessage, res: ServerResponse): void {
    try {
      this.runSessionCleanup()
      const requestUrl = new URL(req.url || '/', `http://localhost:${this.callbackPort}`)
      const path = requestUrl.pathname
      if (path !== '/auth/callback' && path !== '/oauth/callback') {
        res.statusCode = 404
        res.end('Not found')
        return
      }

      const state = requestUrl.searchParams.get('state')?.trim() || ''
      const code = requestUrl.searchParams.get('code')?.trim() || ''
      const error = requestUrl.searchParams.get('error')?.trim() || ''
      const errorDescription = requestUrl.searchParams.get('error_description')?.trim() || ''

      if (state) {
        this.browserCallbackResults.set(state, {
          result: {
            state,
            ...(code ? { code } : {}),
            ...(error ? { error } : {}),
            ...(errorDescription ? { errorDescription } : {})
          },
          expiresAt: Date.now() + BROWSER_CALLBACK_TTL_MS
        })
        if (code && !error) {
          void this.tryAutoCompleteBrowserAuth(state, code)
        }
      }

      if (error) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(callbackErrorHtml(errorDescription || error))
        return
      }

      if (!code) {
        res.statusCode = 400
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(callbackErrorHtml('Missing authorization code'))
        return
      }

      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(CALLBACK_SUCCESS_HTML)
    } catch {
      res.statusCode = 500
      res.end('OAuth callback failed')
    }
  }

  async startDeviceAuth(input: StartDeviceAuthInput): Promise<OpenAICodexDeviceAuthorization> {
    this.runSessionCleanup()
    const scope = normalizeScope(input.scope)
    const response = await this.fetchImpl(this.deviceAuthorizeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: this.clientId,
        scope
      })
    })

    const payload = await parseJsonSafely(response)
    if (!response.ok) {
      throw new Error(`Device authorization failed: ${payload.error || response.status}`)
    }

    const deviceCode = `${payload.device_code || payload.device_auth_id || ''}`
    const userCode = `${payload.user_code || ''}`
    const verificationUri =
      `${payload.verification_uri || payload.verification_uri_complete || ''}` ||
      'https://auth.openai.com/codex/device'
    const intervalSecRaw = Number(payload.interval || 5)
    const expiresInRaw = Number(payload.expires_in || 1800)
    const intervalSec = Number.isFinite(intervalSecRaw) && intervalSecRaw > 0 ? intervalSecRaw : 5
    const expiresIn = Number.isFinite(expiresInRaw) && expiresInRaw > 0 ? expiresInRaw : 1800

    this.deviceSessions.set(deviceCode, {
      session: {
        tenantId: input.tenantId,
        accountId: input.accountId,
        scope,
        userCode: userCode || undefined,
        flowType: payload.device_auth_id ? 'device_auth_id' : 'device_code'
      },
      expiresAt: Date.now() + expiresIn * 1000 + DEVICE_SESSION_GRACE_MS
    })

    return {
      deviceCode,
      userCode,
      verificationUri,
      intervalSec,
      expiresIn
    }
  }

  async pollDeviceAuth(input: PollDeviceAuthInput): Promise<PollDeviceAuthResult> {
    this.runSessionCleanup()
    const deviceSessionEntry = this.deviceSessions.get(input.deviceCode)
    if (!deviceSessionEntry || deviceSessionEntry.expiresAt <= Date.now()) {
      this.deviceSessions.delete(input.deviceCode)
      throw new Error('Device session expired. Start authorization again.')
    }
    const deviceSession = deviceSessionEntry.session
    if (!deviceSession) {
      throw new Error('Device session not found')
    }

    const requestBody =
      deviceSession.flowType === 'device_auth_id'
        ? {
            device_auth_id: input.deviceCode,
            user_code: deviceSession.userCode || ''
          }
        : {
            client_id: this.clientId,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
            device_code: input.deviceCode
          }

    const response = await this.fetchImpl(this.deviceTokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    })

    const payload = await parseJsonSafely(response)
    if (response.status === 428 || response.status === 403 || response.status === 404 || isAuthorizationPending(payload)) {
      return { status: 'pending' }
    }
    if (!response.ok) {
      throw new Error(`Device token exchange failed: ${payload.error || payload.message || response.status}`)
    }

    let tokenPayload: Record<string, unknown> = payload
    const authorizationCode = `${payload.authorization_code || ''}`.trim()
    const codeVerifier = `${payload.code_verifier || ''}`.trim()
    if (authorizationCode && codeVerifier) {
      const exchangeResponse = await this.fetchImpl(this.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: authorizationCode,
          redirect_uri: 'https://auth.openai.com/deviceauth/callback',
          client_id: this.clientId,
          code_verifier: codeVerifier
        }).toString()
      })
      const exchangePayload = await parseJsonSafely(exchangeResponse)
      if (!exchangeResponse.ok) {
        throw new Error(`Device token exchange failed: ${exchangePayload.error || exchangeResponse.status}`)
      }
      tokenPayload = exchangePayload
    }

    const token = this.toOAuthToken(tokenPayload)
    const credential = await this.upsertCredential({
      tenantId: deviceSession.tenantId,
      accountId: deviceSession.accountId || token.accountId,
      token,
      authMethod: 'oauth_device'
    })
    this.deviceSessions.delete(input.deviceCode)

    return {
      status: 'authorized',
      credential,
      token
    }
  }

  async getActiveCredential(
    tenantId: string,
    accountId?: string
  ): Promise<OpenAICodexCredential | null> {
    return this.credentialStore.getActive(tenantId, OPENAI_CODEX_PROVIDER_ID, accountId)
  }

  private toOAuthToken(payload: Record<string, unknown>): OpenAICodexOAuthToken {
    const accessToken = `${payload.access_token || ''}`.trim()
    if (!accessToken) {
      throw new Error('OAuth token response missing access_token')
    }

    const refreshToken = `${payload.refresh_token || ''}`.trim() || undefined
    const tokenType = `${payload.token_type || ''}`.trim() || undefined
    const scope = `${payload.scope || ''}`.trim() || undefined
    const idToken = `${payload.id_token || ''}`.trim()
    const accountId =
      `${payload.account_id || payload.accountId || ''}`.trim() ||
      extractAccountIdFromClaims(decodeJwtPayload(idToken)) ||
      extractAccountIdFromClaims(decodeJwtPayload(accessToken)) ||
      undefined
    const subject = `${payload.sub || payload.subject || ''}`.trim() || undefined
    const expiresRaw = Number(payload.expires_in || payload.expiresIn)
    const expiresIn = Number.isFinite(expiresRaw) && expiresRaw > 0 ? expiresRaw : undefined

    return {
      accessToken,
      refreshToken,
      tokenType,
      scope,
      expiresIn,
      accountId,
      subject
    }
  }

  private async upsertCredential(input: {
    tenantId: string
    accountId?: string
    token: OpenAICodexOAuthToken
    authMethod: 'oauth_browser' | 'oauth_device'
  }): Promise<OpenAICodexCredential> {
    const credential: OpenAICodexCredential = {
      id: randomUUID(),
      tenantId: input.tenantId,
      providerId: OPENAI_CODEX_PROVIDER_ID,
      authMethod: input.authMethod,
      accountId: input.accountId,
      subject: input.token.subject,
      accessToken: input.token.accessToken,
      refreshToken: input.token.refreshToken,
      tokenType: input.token.tokenType,
      scope: input.token.scope,
      expiresAt: toExpiresAt(input.token.expiresIn),
      meta: {}
    }

    await this.credentialStore.upsert(credential)
    return credential
  }
}

let singleton: OpenAICodexOAuthService | null = null

export function getOpenAICodexOAuthService(): OpenAICodexOAuthService {
  if (!singleton) {
    singleton = new OpenAICodexOAuthService()
  }
  return singleton
}

export function _testResetOpenAICodexOAuthService(): void {
  singleton = null
}
