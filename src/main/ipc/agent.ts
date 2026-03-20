/**
 * Agent IPC Handlers
 */

import { ipcMain, BrowserWindow } from 'electron'
import * as agentController from '../controllers/agent.controller'
import {
  setAgentMode,
  getSessionState,
  ensureSessionWarm,
  testMcpConnections,
  reconnectMcpServer,
  toggleMcpServer,
  getWorkingDir,
  getV2SessionInfo
} from '../services/agent'
import type { AskUserQuestionAnswerInput } from '../services/agent'
import type { InvocationContext } from '../../shared/resource-access'
import type { LocaleCode } from '../../shared/i18n/locale'
import { getResourceIndexHash } from '../services/resource-index.service'
import { executeIdempotentOperation } from '../services/agent/op-id.service'
import { buildSessionKey } from '../../shared/session-key'

let mainWindow: BrowserWindow | null = null

function toErrorResponse(error: unknown): { success: false; error: string; errorCode?: string } {
  const err = error as Error & { errorCode?: string }
  console.error('[IPC][agent] request failed', {
    message: err?.message || String(error),
    errorCode: typeof err?.errorCode === 'string' ? err.errorCode : undefined
  })
  return {
    success: false,
    error: err?.message || String(error),
    errorCode: typeof err?.errorCode === 'string' ? err.errorCode : undefined
  }
}

type SendMessageIpcRequest = {
  spaceId: string
  conversationId: string
  message: string
  opId?: string
  responseLanguage?: LocaleCode | string
  resumeSessionId?: string
  modelOverride?: string
  model?: string
  images?: Array<{
    id: string
    type: 'image'
    mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
    data: string
    name?: string
    size?: number
  }>
  thinkingEnabled?: boolean
  planEnabled?: boolean
  mode?: 'code' | 'plan'
  invocationContext?: InvocationContext
  canvasContext?: {
    isOpen: boolean
    tabCount: number
    activeTab: { type: string; title: string; url?: string; path?: string } | null
    tabs: Array<{ type: string; title: string; url?: string; path?: string; isActive: boolean }>
  }
  fileContexts?: Array<{
    id: string
    type: 'file-context'
    path: string
    name: string
    extension: string
  }>
}

type GuideMessageIpcRequest = {
  spaceId: string
  conversationId: string
  message: string
  opId?: string
  runId?: string
  clientMessageId?: string
}

export function registerAgentHandlers(window: BrowserWindow | null): void {
  mainWindow = window

  // Send message to agent (with optional images for multi-modal, optional thinking mode)
  ipcMain.handle(
    'agent:send-message',
    async (
      _event,
      request: SendMessageIpcRequest
    ) => {
      try {
        if (request.invocationContext && request.invocationContext !== 'interactive') {
          return {
            success: false,
            error: `invocationContext "${request.invocationContext}" is not allowed for agent:send-message`
          }
        }

        const normalizedModelOverride = request.modelOverride || request.model
        const normalizedRequest = normalizedModelOverride
          ? { ...request, modelOverride: normalizedModelOverride, invocationContext: 'interactive' as InvocationContext }
          : { ...request, invocationContext: 'interactive' as InvocationContext }
        return await agentController.sendMessage(mainWindow, normalizedRequest)
      } catch (error: unknown) {
        return toErrorResponse(error)
      }
    }
  )

  ipcMain.handle(
    'agent:set-mode',
    async (
      _event,
      request: { spaceId: string; conversationId: string; mode: 'code' | 'plan'; runId?: string }
    ) => {
      try {
        const result = await setAgentMode(request.spaceId, request.conversationId, request.mode, request.runId)
        return { success: true, data: result }
      } catch (error: unknown) {
        const err = error as Error
        return { success: false, error: err.message }
      }
    }
  )

  ipcMain.handle(
    'agent:guide-message',
    async (_event, request: GuideMessageIpcRequest) => {
      try {
        return await agentController.guideMessage(mainWindow, request)
      } catch (error: unknown) {
        return toErrorResponse(error)
      }
    }
  )

  // Backward-compatible fallback for old preload bridges (window.kite.guideMessage missing).
  // Request shape: { spaceId, conversationId, message, runId?, clientMessageId?, replyChannel }.
  ipcMain.on(
    'agent:guide-message-fallback',
    async (event, payload: GuideMessageIpcRequest & { replyChannel?: string }) => {
      const replyChannel = typeof payload?.replyChannel === 'string' ? payload.replyChannel : ''
      if (!replyChannel) {
        const error = '[IPC] agent:guide-message-fallback missing replyChannel'
        console.error(error)
        event.sender.send('agent:guide-message-fallback:error', {
          success: false,
          error,
          errorCode: 'IPC_FALLBACK_REPLY_CHANNEL_MISSING'
        })
        return
      }

      try {
        const { spaceId, conversationId, message, opId, runId, clientMessageId } = payload || {}
        const response = await agentController.guideMessage(mainWindow, {
          spaceId,
          conversationId,
          message,
          opId,
          runId,
          clientMessageId
        })
        event.sender.send(replyChannel, response)
      } catch (error: unknown) {
        event.sender.send(replyChannel, toErrorResponse(error))
      }
    }
  )

  // Stop generation for a specific conversation (or all in space if not specified)
  ipcMain.handle('agent:stop', async (_event, request: { spaceId: string; conversationId?: string; opId?: string }) => {
    try {
      return await agentController.stopGeneration(request.spaceId, request.conversationId, request.opId)
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })

  // Approve tool execution for a specific conversation
  ipcMain.handle('agent:approve-tool', async (_event, request: { spaceId: string; conversationId: string; opId?: string }) => {
    try {
      return await agentController.approveTool(request.spaceId, request.conversationId, request.opId)
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })

  // Reject tool execution for a specific conversation
  ipcMain.handle('agent:reject-tool', async (_event, request: { spaceId: string; conversationId: string; opId?: string }) => {
    try {
      return await agentController.rejectTool(request.spaceId, request.conversationId, request.opId)
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })

  // Answer AskUserQuestion for a specific conversation
  ipcMain.handle('agent:answer-question', async (
    _event,
    request: { spaceId: string; conversationId: string; answer: AskUserQuestionAnswerInput; opId?: string }
  ) => {
    try {
      return await agentController.answerQuestion(
        request.spaceId,
        request.conversationId,
        request.answer,
        request.opId
      )
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })

  // Get current session state for recovery after refresh
  ipcMain.handle('agent:get-session-state', async (
    _event,
    request: { spaceId: string; conversationId: string }
  ) => {
    try {
      const state = getSessionState(request.spaceId, request.conversationId)
      return { success: true, data: state }
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })

  // Warm up V2 session - call when switching conversations to prepare for faster message sending
  ipcMain.handle(
    'agent:ensure-session-warm',
    async (
      _event,
      spaceId: string,
      conversationId: string,
      responseLanguage?: LocaleCode | string,
      options?: { waitForReady?: boolean }
    ) => {
    try {
      const waitForReady = options?.waitForReady === true
      if (waitForReady) {
        await ensureSessionWarm(spaceId, conversationId, responseLanguage)
      } else {
        // Async initialization, non-blocking IPC call
        ensureSessionWarm(spaceId, conversationId, responseLanguage).catch((error: unknown) => {
          console.error('[IPC] ensureSessionWarm error:', error)
        })
      }
      return { success: true }
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
    }
  )

  ipcMain.handle(
    'agent:get-resource-hash',
    async (_event, params?: { spaceId?: string; workDir?: string; conversationId?: string }) => {
      try {
        const resolvedWorkDir = params?.workDir
          || (typeof params?.spaceId === 'string' ? getWorkingDir(params.spaceId) : undefined)
        const sessionInfo = params?.conversationId && params?.spaceId
          ? getV2SessionInfo(params.spaceId, params.conversationId)
          : undefined
        return {
          success: true,
          data: {
            hash: getResourceIndexHash(resolvedWorkDir),
            workDir: resolvedWorkDir || null,
            sessionResourceHash: sessionInfo?.config.resourceIndexHash || null
          }
        }
      } catch (error: unknown) {
        return toErrorResponse(error)
      }
    }
  )

  // Test MCP server connections
  ipcMain.handle('agent:test-mcp', async () => {
    try {
      const result = await testMcpConnections(mainWindow)
      return result
    } catch (error: unknown) {
      const errorResponse = toErrorResponse(error)
      return { ...errorResponse, servers: [] }
    }
  })

  // Reconnect a failed MCP server
  ipcMain.handle('agent:reconnect-mcp', async (
    _event,
    request: { spaceId: string; conversationId: string; serverName: string; opId?: string }
  ) => {
    try {
      const execution = await executeIdempotentOperation({
        scopeKey: buildSessionKey(request.spaceId, request.conversationId),
        operation: 'reconnect-mcp',
        opId: request.opId,
        execute: () => reconnectMcpServer(request.spaceId, request.conversationId, request.serverName)
      })
      return {
        ...execution.result,
        ...(execution.replayed ? { errorCode: 'OP_DUPLICATE_REPLAYED' } : {})
      }
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })

  // Toggle (enable/disable) an MCP server
  ipcMain.handle('agent:toggle-mcp', async (
    _event,
    request: { spaceId: string; conversationId: string; serverName: string; enabled: boolean }
  ) => {
    try {
      const result = await toggleMcpServer(
        request.spaceId,
        request.conversationId,
        request.serverName,
        request.enabled
      )
      return result
    } catch (error: unknown) {
      return toErrorResponse(error)
    }
  })
}
