/**
 * WebSocket Manager - Handles real-time communication with remote clients
 * Replaces IPC events for remote access
 */

import { WebSocket, WebSocketServer } from 'ws'
import { IncomingMessage } from 'http'
import { v4 as uuidv4 } from 'uuid'
import { validateToken } from './auth'
import { assertValidSessionKey, buildSessionKey } from '../../shared/session-key'

interface WebSocketClient {
  id: string
  ws: WebSocket
  authenticated: boolean
  subscriptions: Set<string> // session keys this client is subscribed to
}

const WS_ERROR_CODES = {
  NOT_AUTHENTICATED: 'WS_NOT_AUTHENTICATED',
  SUBSCRIBE_SCHEMA_DEPRECATED: 'WS_SUBSCRIBE_SCHEMA_DEPRECATED',
  SUBSCRIBE_SCHEMA_INVALID: 'WS_SUBSCRIBE_SCHEMA_INVALID',
  UNSUBSCRIBE_SCHEMA_INVALID: 'WS_UNSUBSCRIBE_SCHEMA_INVALID'
} as const

function toSessionSubscriptionKey(payload: unknown): { key?: string; code?: string; error?: string; deprecated?: boolean } {
  if (!payload || typeof payload !== 'object') {
    return {
      code: WS_ERROR_CODES.SUBSCRIBE_SCHEMA_INVALID,
      error: 'subscribe payload must include { spaceId, conversationId }'
    }
  }

  const record = payload as Record<string, unknown>
  const spaceId = typeof record.spaceId === 'string' ? record.spaceId.trim() : ''
  const conversationId = typeof record.conversationId === 'string' ? record.conversationId.trim() : ''

  if (spaceId && conversationId) {
    return { key: buildSessionKey(spaceId, conversationId) }
  }

  if (!spaceId && conversationId) {
    return {
      code: WS_ERROR_CODES.SUBSCRIBE_SCHEMA_DEPRECATED,
      error: 'conversationId-only subscribe payload is deprecated; use { spaceId, conversationId }',
      deprecated: true
    }
  }

  return {
    code: WS_ERROR_CODES.SUBSCRIBE_SCHEMA_INVALID,
    error: 'subscribe payload must include non-empty spaceId and conversationId'
  }
}

// Store all connected clients
const clients = new Map<string, WebSocketClient>()

// WebSocket server instance
let wss: WebSocketServer | null = null

/**
 * Initialize WebSocket server
 */
export function initWebSocket(server: any): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const clientId = uuidv4()
    const client: WebSocketClient = {
      id: clientId,
      ws,
      authenticated: false,
      subscriptions: new Set()
    }

    clients.set(clientId, client)
    console.log(`[WS] Client connected: ${clientId}`)

    // Handle messages from client
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString())
        handleClientMessage(client, message)
      } catch (error) {
        console.error('[WS] Invalid message:', error)
      }
    })

    // Handle disconnection
    ws.on('close', () => {
      clients.delete(clientId)
      console.log(`[WS] Client disconnected: ${clientId}`)
    })

    // Handle errors
    ws.on('error', (error) => {
      console.error(`[WS] Client error ${clientId}:`, error)
      clients.delete(clientId)
    })
  })

  console.log('[WS] WebSocket server initialized')
  return wss
}

/**
 * Handle incoming message from client
 */
function handleClientMessage(
  client: WebSocketClient,
  message: { type: string; payload?: any }
): void {
  switch (message.type) {
    case 'auth':
      // Validate the token before marking as authenticated
      if (message.payload?.token && validateToken(message.payload.token)) {
        client.authenticated = true
        sendToClient(client, { type: 'auth:success' })
        console.log(`[WS] Client ${client.id} authenticated successfully`)
      } else {
        sendToClient(client, { type: 'auth:failed', error: 'Invalid token' })
        console.log(`[WS] Client ${client.id} authentication failed`)
        // Close connection after failed auth
        setTimeout(() => client.ws.close(), 100)
      }
      break

    case 'subscribe':
      // Subscribe to conversation events (requires authentication)
      if (!client.authenticated) {
        sendToClient(client, {
          type: 'error',
          code: WS_ERROR_CODES.NOT_AUTHENTICATED,
          error: 'Not authenticated'
        })
        break
      }
      {
        const resolved = toSessionSubscriptionKey(message.payload)
        if (!resolved.key) {
          sendToClient(client, {
            type: 'error',
            code: resolved.code,
            error: resolved.error,
            ...(resolved.deprecated ? { deprecated: true } : {})
          })
          break
        }
        client.subscriptions.add(resolved.key)
        console.log(`[WS] Client ${client.id} subscribed to ${resolved.key}`)
      }
      break

    case 'unsubscribe':
      {
        const resolved = toSessionSubscriptionKey(message.payload)
        if (!resolved.key) {
          sendToClient(client, {
            type: 'error',
            code: resolved.code || WS_ERROR_CODES.UNSUBSCRIBE_SCHEMA_INVALID,
            error: resolved.error || 'unsubscribe payload must include { spaceId, conversationId }',
            ...(resolved.deprecated ? { deprecated: true } : {})
          })
          break
        }
        client.subscriptions.delete(resolved.key)
      }
      break

    case 'ping':
      sendToClient(client, { type: 'pong' })
      break

    default:
      console.log(`[WS] Unknown message type: ${message.type}`)
  }
}

/**
 * Send message to a specific client
 */
function sendToClient(client: WebSocketClient, message: object): void {
  if (client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(message))
  }
}

/**
 * Broadcast event to all subscribed clients
 * This is called from agent.service.ts
 */
export function broadcastToWebSocket(
  channel: string,
  data: Record<string, unknown>
): void {
  const sessionKeyFromPayload = typeof data.sessionKey === 'string' ? data.sessionKey : ''
  const spaceId = typeof data.spaceId === 'string' ? data.spaceId : ''
  const conversationId = typeof data.conversationId === 'string' ? data.conversationId : ''
  const derivedSessionKey = spaceId && conversationId ? buildSessionKey(spaceId, conversationId) : ''

  const sessionKey = (() => {
    if (sessionKeyFromPayload) {
      try {
        assertValidSessionKey(sessionKeyFromPayload)
      } catch (error) {
        console.warn('[WS] Invalid payload sessionKey rejected', {
          channel,
          errorCode: (error as { errorCode?: string })?.errorCode || 'SESSION_KEY_INVALID'
        })
        return ''
      }
      if (derivedSessionKey && sessionKeyFromPayload !== derivedSessionKey) {
        console.warn(
          `[WS] broadcastToWebSocket sessionKey mismatch for channel=${channel}; payload sessionKey ignored`
        )
        return ''
      }
      return sessionKeyFromPayload
    }
    return derivedSessionKey
  })()

  if (!sessionKey) {
    console.warn(`[WS] broadcastToWebSocket called without valid session scope for channel: ${channel}`)
    return
  }

  for (const client of Array.from(clients.values())) {
    // Only send to authenticated clients subscribed to this exact session scope.
    if (client.authenticated && client.subscriptions.has(sessionKey)) {
      sendToClient(client, {
        type: 'event',
        channel,
        data
      })
    }
  }
}

/**
 * Broadcast to all authenticated clients (for global events)
 */
export function broadcastToAll(channel: string, data: Record<string, unknown>): void {
  for (const client of Array.from(clients.values())) {
    if (client.authenticated) {
      sendToClient(client, {
        type: 'event',
        channel,
        data
      })
    }
  }
}

/**
 * Get connected client count
 */
export function getClientCount(): number {
  return clients.size
}

/**
 * Get authenticated client count
 */
export function getAuthenticatedClientCount(): number {
  let count = 0
  for (const client of Array.from(clients.values())) {
    if (client.authenticated) count++
  }
  return count
}

/**
 * Shutdown WebSocket server
 */
export function shutdownWebSocket(): void {
  if (wss) {
    for (const client of Array.from(clients.values())) {
      client.ws.close()
    }
    clients.clear()
    wss.close()
    wss = null
    console.log('[WS] WebSocket server shutdown')
  }
}
