/**
 * Kite API - Unified interface for both IPC and HTTP modes
 * Automatically selects the appropriate transport
 */

import {
  isElectron,
  httpRequest,
  onEvent,
  connectWebSocket,
  disconnectWebSocket,
  subscribeToConversation,
  unsubscribeFromConversation,
  setAuthToken,
  clearAuthToken,
  getAuthToken
} from './transport'
import type { ChatMode } from '../types'
import type { InvocationContext, ResourceListView } from '../../shared/resource-access'
import type { LocaleCode } from '../../shared/i18n/locale'

// Response type
interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  errorCode?: string
}

interface AskUserQuestionAnswerPayload {
  toolCallId: string
  answersByQuestionId: Record<string, string[]>
  skippedQuestionIds: string[]
  runId?: string
}

interface GuideMessageRequest {
  spaceId: string
  conversationId: string
  message: string
  opId?: string
  runId?: string
  clientMessageId?: string
}

interface PythonRuntimeStatus {
  found: boolean
  pythonCommand: string | null
  pythonVersion: string | null
  pipReady: boolean
  missingModules: string[]
  installSupported: boolean
  installStrategy: 'windows-system-silent' | 'manual-guidance'
}

function createOpId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * API object - drop-in replacement for window.kite
 * Works in both Electron and remote web mode
 */
export const api = {
  // ===== Authentication (remote only) =====
  isRemoteMode: () => !isElectron(),
  isAuthenticated: () => !!getAuthToken(),

  login: async (token: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return { success: true }
    }

    const result = await httpRequest<void>('POST', '/api/remote/login', { token })
    if (result.success) {
      setAuthToken(token)
      connectWebSocket()
    }
    return result
  },

  logout: () => {
    clearAuthToken()
    disconnectWebSocket()
  },

  // ===== Config =====
  getConfig: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getConfig()
    }
    return httpRequest('GET', '/api/config')
  },

  setConfig: async (updates: Record<string, unknown>): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.setConfig(updates)
    }
    return httpRequest('POST', '/api/config', updates)
  },

  validateApi: async (
    apiKey: string,
    apiUrl: string,
    provider: string,
    protocol?: string,
    model?: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.validateApi(apiKey, apiUrl, provider, protocol, model)
    }
    return httpRequest('POST', '/api/config/validate', { apiKey, apiUrl, provider, protocol, model })
  },

  // ===== Space =====
  getKiteSpace: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getKiteSpace()
    }
    return httpRequest('GET', '/api/spaces/kite')
  },

  listSpaces: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listSpaces()
    }
    return httpRequest('GET', '/api/spaces')
  },

  createSpace: async (input: {
    name: string
    icon: string
    customPath?: string
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createSpace(input)
    }
    return httpRequest('POST', '/api/spaces', input)
  },

  deleteSpace: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.deleteSpace(spaceId)
    }
    return httpRequest('DELETE', `/api/spaces/${spaceId}`)
  },

  getSpace: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getSpace(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}`)
  },

  openSpaceFolder: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.openSpaceFolder(spaceId)
    }
    // In remote mode, just return the path (can't open folder remotely)
    return httpRequest('POST', `/api/spaces/${spaceId}/open`)
  },

  getDefaultSpacePath: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getDefaultSpacePath()
    }
    // In remote mode, get default path from server
    return httpRequest('GET', '/api/spaces/default-path')
  },

  selectFolder: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.selectFolder()
    }
    // Cannot select folder in remote mode
    return { success: false, error: 'Cannot select folder in remote mode' }
  },

  selectFiles: async (): Promise<ApiResponse<string[]>> => {
    if (isElectron()) {
      return window.kite.selectFiles()
    }
    // Cannot select files in remote mode
    return { success: false, error: 'Cannot select files in remote mode' }
  },

  updateSpace: async (
    spaceId: string,
    updates: { name?: string; icon?: string }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateSpace(spaceId, updates)
    }
    return httpRequest('PUT', `/api/spaces/${spaceId}`, updates)
  },

  // Update space preferences (layout settings)
  updateSpacePreferences: async (
    spaceId: string,
    preferences: {
      layout?: {
        artifactRailExpanded?: boolean
        chatWidth?: number
      }
      skills?: {
        favorites?: string[]
      }
    }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateSpacePreferences(spaceId, preferences)
    }
    return httpRequest('PUT', `/api/spaces/${spaceId}/preferences`, preferences)
  },

  // Get space preferences
  getSpacePreferences: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getSpacePreferences(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/preferences`)
  },

  // ===== Conversation =====
  listConversations: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listConversations(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/conversations`)
  },

  createConversation: async (spaceId: string, title?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createConversation(spaceId, title)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/conversations`, { title })
  },

  getConversation: async (
    spaceId: string,
    conversationId: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getConversation(spaceId, conversationId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/conversations/${conversationId}`)
  },

  updateConversation: async (
    spaceId: string,
    conversationId: string,
    updates: Record<string, unknown>
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateConversation(spaceId, conversationId, updates)
    }
    return httpRequest(
      'PUT',
      `/api/spaces/${spaceId}/conversations/${conversationId}`,
      updates
    )
  },

  deleteConversation: async (
    spaceId: string,
    conversationId: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.deleteConversation(spaceId, conversationId)
    }
    return httpRequest(
      'DELETE',
      `/api/spaces/${spaceId}/conversations/${conversationId}`
    )
  },

  addMessage: async (
    spaceId: string,
    conversationId: string,
    message: { role: string; content: string }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.addMessage(spaceId, conversationId, message)
    }
    return httpRequest(
      'POST',
      `/api/spaces/${spaceId}/conversations/${conversationId}/messages`,
      message
    )
  },

  updateLastMessage: async (
    spaceId: string,
    conversationId: string,
    updates: Record<string, unknown>
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateLastMessage(spaceId, conversationId, updates)
    }
    return httpRequest(
      'PUT',
      `/api/spaces/${spaceId}/conversations/${conversationId}/messages/last`,
      updates
    )
  },

  // ===== Change Sets =====
  listChangeSets: async (spaceId: string, conversationId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listChangeSets(spaceId, conversationId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/conversations/${conversationId}/change-sets`)
  },

  acceptChangeSet: async (params: {
    spaceId: string
    conversationId: string
    changeSetId: string
    filePath?: string
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.acceptChangeSet(params)
    }
    return httpRequest(
      'POST',
      `/api/spaces/${params.spaceId}/conversations/${params.conversationId}/change-sets/accept`,
      { changeSetId: params.changeSetId, filePath: params.filePath }
    )
  },

  rollbackChangeSet: async (params: {
    spaceId: string
    conversationId: string
    changeSetId: string
    filePath?: string
    force?: boolean
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.rollbackChangeSet(params)
    }
    return httpRequest(
      'POST',
      `/api/spaces/${params.spaceId}/conversations/${params.conversationId}/change-sets/rollback`,
      { changeSetId: params.changeSetId, filePath: params.filePath, force: params.force }
    )
  },

  // ===== Agent =====
  sendMessage: async (request: {
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
    thinkingEnabled?: boolean  // Enable extended thinking mode
    planEnabled?: boolean  // Enable plan mode (no tool execution)
    mode?: ChatMode
    invocationContext?: InvocationContext
    canvasContext?: {  // Canvas context for AI awareness
      isOpen: boolean
      tabCount: number
      activeTab: {
        type: string
        title: string
        url?: string
        path?: string
      } | null
      tabs: Array<{
        type: string
        title: string
        url?: string
        path?: string
        isActive: boolean
      }>
    }
    fileContexts?: Array<{  // File contexts for context injection
      id: string
      type: 'file-context'
      path: string
      name: string
      extension: string
    }>
  }): Promise<ApiResponse> => {
    const normalizedRequest = {
      ...request,
      opId: request.opId || createOpId('send')
    }
    // Subscribe to conversation events before sending
    if (!isElectron()) {
      subscribeToConversation(normalizedRequest.spaceId, normalizedRequest.conversationId)
    }

    if (isElectron()) {
      return window.kite.sendMessage(normalizedRequest)
    }
    return httpRequest('POST', '/api/agent/message', normalizedRequest)
  },

  setAgentMode: async (
    spaceId: string,
    conversationId: string,
    mode: ChatMode,
    runId?: string
  ): Promise<ApiResponse<{ applied: boolean; mode: ChatMode; runId?: string; reason?: string; error?: string }>> => {
    if (isElectron()) {
      return window.kite.setAgentMode(spaceId, conversationId, mode, runId)
    }
    return httpRequest('POST', '/api/agent/mode', { spaceId, conversationId, mode, runId })
  },

  guideMessage: async (
    request: GuideMessageRequest
  ): Promise<ApiResponse<{ delivery: 'session_send' | 'ask_user_question_answer' }>> => {
    const normalizedRequest = {
      ...request,
      opId: request.opId || createOpId('guide-message')
    }
    if (isElectron()) {
      const bridge = (window as unknown as { kite?: { guideMessage?: (payload: GuideMessageRequest) => Promise<ApiResponse<{ delivery: 'session_send' | 'ask_user_question_answer' }>> } }).kite
      if (!bridge || typeof bridge.guideMessage !== 'function') {
        // Backward-compatible fallback for stale preload bridge:
        // use window.electron.ipcRenderer.send/on round-trip channel.
        const electronBridge = (window as unknown as {
          electron?: {
            ipcRenderer?: {
              on?: (channel: string, callback: (...args: unknown[]) => void) => void
              removeListener?: (channel: string, callback: (...args: unknown[]) => void) => void
              send?: (channel: string, ...args: unknown[]) => void
            }
          }
        }).electron?.ipcRenderer

        if (
          electronBridge &&
          typeof electronBridge.send === 'function' &&
          typeof electronBridge.on === 'function' &&
          typeof electronBridge.removeListener === 'function'
        ) {
          return await new Promise((resolve) => {
            const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
            const replyChannel = `agent:guide-message-fallback:reply:${requestId}`
            const timeoutId = window.setTimeout(() => {
              electronBridge.removeListener?.(replyChannel, onReply)
              resolve({
                success: false,
                error: 'IPC bridge unavailable: guideMessage (fallback timeout)'
              })
            }, 12000)

            const onReply = (response: unknown) => {
              window.clearTimeout(timeoutId)
              electronBridge.removeListener?.(replyChannel, onReply)
              resolve((response as ApiResponse<{ delivery: 'session_send' | 'ask_user_question_answer' }>) || {
                success: false,
                error: 'IPC fallback returned empty response'
              })
            }

            electronBridge.on(replyChannel, onReply)
            electronBridge.send('agent:guide-message-fallback', {
              ...normalizedRequest,
              replyChannel
            })
          })
        }
        return {
          success: false,
          error: 'IPC bridge unavailable: guideMessage'
        }
      }
      return bridge.guideMessage(normalizedRequest)
    }
    return httpRequest('POST', '/api/agent/guide-message', normalizedRequest)
  },

  stopGeneration: async (spaceId: string, conversationId?: string, opId?: string): Promise<ApiResponse> => {
    const normalizedOpId = opId || createOpId('stop')
    if (isElectron()) {
      return window.kite.stopGeneration(spaceId, conversationId, normalizedOpId)
    }
    return httpRequest('POST', '/api/agent/stop', { spaceId, conversationId, opId: normalizedOpId })
  },

  approveTool: async (spaceId: string, conversationId: string, opId?: string): Promise<ApiResponse> => {
    const normalizedOpId = opId || createOpId('approve')
    if (isElectron()) {
      return window.kite.approveTool(spaceId, conversationId, normalizedOpId)
    }
    return httpRequest('POST', '/api/agent/approve', { spaceId, conversationId, opId: normalizedOpId })
  },

  rejectTool: async (spaceId: string, conversationId: string, opId?: string): Promise<ApiResponse> => {
    const normalizedOpId = opId || createOpId('reject')
    if (isElectron()) {
      return window.kite.rejectTool(spaceId, conversationId, normalizedOpId)
    }
    return httpRequest('POST', '/api/agent/reject', { spaceId, conversationId, opId: normalizedOpId })
  },

  answerQuestion: async (
    spaceId: string,
    conversationId: string,
    answer: string | AskUserQuestionAnswerPayload,
    opId?: string
  ): Promise<ApiResponse> => {
    const normalizedOpId = opId || createOpId('answer')
    if (isElectron()) {
      const bridge = (window as unknown as {
        kite?: {
          answerQuestion?: (
            spaceId: string,
            id: string,
            payload: string | AskUserQuestionAnswerPayload,
            opId?: string
          ) => Promise<ApiResponse>
        }
      }).kite
      if (!bridge || typeof bridge.answerQuestion !== 'function') {
        return {
          success: false,
          error: 'IPC bridge unavailable: answerQuestion'
        }
      }
      return bridge.answerQuestion(spaceId, conversationId, answer, normalizedOpId)
    }
    if (typeof answer === 'string') {
      return httpRequest('POST', '/api/agent/answer-question', {
        spaceId,
        conversationId,
        answer,
        opId: normalizedOpId
      })
    }
    return httpRequest('POST', '/api/agent/answer-question', {
      spaceId,
      conversationId,
      payload: answer,
      opId: normalizedOpId
    })
  },

  // Get current session state for recovery after refresh
  getSessionState: async (spaceId: string, conversationId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getSessionState(spaceId, conversationId)
    }
    return httpRequest('GET', `/api/agent/session/${conversationId}?spaceId=${encodeURIComponent(spaceId)}`)
  },

  // Warm up V2 session - call when switching conversations to prepare for faster message sending
  ensureSessionWarm: async (
    spaceId: string,
    conversationId: string,
    responseLanguage?: LocaleCode | string,
    options?: { waitForReady?: boolean }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      const invokeWarm = () =>
        options
          ? window.kite.ensureSessionWarm(spaceId, conversationId, responseLanguage, options)
          : window.kite.ensureSessionWarm(spaceId, conversationId, responseLanguage)
      if (options?.waitForReady === true) {
        return invokeWarm()
      }
      // No need to wait by default, initialize in background
      invokeWarm().catch((error: unknown) => {
        console.error('[API] ensureSessionWarm error:', error)
      })
      return { success: true }
    }
    // HTTP mode: send warm-up request to backend
    const warmPayload = options
      ? { spaceId, conversationId, responseLanguage, options }
      : { spaceId, conversationId, responseLanguage }
    return httpRequest('POST', '/api/agent/warm', warmPayload).catch(() => ({
      success: false // Warm-up failure should not block
    }))
  },

  getAgentResourceHash: async (
    params?: { spaceId?: string; workDir?: string; conversationId?: string }
  ): Promise<ApiResponse<{ hash: string; workDir?: string | null; sessionResourceHash?: string | null }>> => {
    if (isElectron()) {
      return window.kite.getAgentResourceHash(params)
    }
    const query = new URLSearchParams()
    if (params?.spaceId) query.append('spaceId', params.spaceId)
    if (params?.workDir) query.append('workDir', params.workDir)
    if (params?.conversationId) query.append('conversationId', params.conversationId)
    const suffix = query.toString()
    return httpRequest('GET', `/api/agent/resource-hash${suffix ? `?${suffix}` : ''}`)
  },

  // Test MCP server connections
  testMcpConnections: async (): Promise<{ success: boolean; servers: unknown[]; error?: string }> => {
    if (isElectron()) {
      return window.kite.testMcpConnections()
    }
    // HTTP mode: call backend endpoint
    const result = await httpRequest('POST', '/api/agent/test-mcp')
    return result as { success: boolean; servers: unknown[]; error?: string }
  },

  // ===== Artifact =====
  listArtifacts: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listArtifacts(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/artifacts`)
  },

  listArtifactsTree: async (spaceId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listArtifactsTree(spaceId)
    }
    return httpRequest('GET', `/api/spaces/${spaceId}/artifacts/tree`)
  },

  openArtifact: async (filePath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.openArtifact(filePath)
    }
    // Can't open files remotely
    return { success: false, error: 'Cannot open files in remote mode' }
  },

  showArtifactInFolder: async (filePath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.showArtifactInFolder(filePath)
    }
    // Can't open folder remotely
    return { success: false, error: 'Cannot open folder in remote mode' }
  },

  // Download artifact (remote mode only - triggers browser download)
  downloadArtifact: (filePath: string): void => {
    if (isElectron()) {
      // In Electron, just open the file
      window.kite.openArtifact(filePath)
      return
    }
    // In remote mode, trigger download via browser with token in URL
    const token = getAuthToken()
    const url = `/api/artifacts/download?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token || '')}`
    const link = document.createElement('a')
    link.href = url
    link.download = filePath.split('/').pop() || 'download'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  },

  // Get download URL for an artifact (for use with fetch or direct links)
  getArtifactDownloadUrl: (filePath: string): string => {
    const token = getAuthToken()
    return `/api/artifacts/download?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token || '')}`
  },

  // Read artifact content for Content Canvas
  readArtifactContent: async (filePath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.readArtifactContent(filePath)
    }
    // In remote mode, fetch content via API
    return httpRequest('GET', `/api/artifacts/content?path=${encodeURIComponent(filePath)}`)
  },

  // Write artifact content for Content Canvas editing
  writeArtifactContent: async (filePath: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.writeArtifactContent(filePath, content)
    }
    // In remote mode, write content via API
    return httpRequest('POST', '/api/artifacts/content', { path: filePath, content })
  },

  // Create a new folder
  createFolder: async (folderPath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createFolder(folderPath)
    }
    return httpRequest('POST', '/api/artifacts/folder', { path: folderPath })
  },

  // Create a new file
  createFile: async (filePath: string, content?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createFile(filePath, content)
    }
    return httpRequest('POST', '/api/artifacts/file', { path: filePath, content })
  },

  // Create a file/folder in parent directory (desktop IPC only)
  createArtifactEntry: async <T = unknown>(params: {
    type: 'file' | 'folder'
    parentPath: string
    name: string
    content?: string
  }): Promise<ApiResponse<T>> => {
    if (!isElectron()) {
      return { success: false, error: 'Create entry is only supported in desktop mode' }
    }

    try {
      // Preferred path: new unified IPC
      if (typeof window.kite.createArtifactEntry === 'function') {
        return window.kite.createArtifactEntry(params)
      }

      // Backward-compatible fallback for clients with old preload
      const trimmedParent = params.parentPath.replace(/[\\/]+$/, '')
      const separator = trimmedParent.includes('\\') && !trimmedParent.includes('/') ? '\\' : '/'
      const fullPath = trimmedParent ? `${trimmedParent}${separator}${params.name}` : params.name
      if (params.type === 'folder') {
        return window.kite.createFolder(fullPath)
      }
      return window.kite.createFile(fullPath, params.content)
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create entry'
      }
    }
  },

  // Rename a file or folder
  renameArtifact: async (oldPath: string, newName: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.renameArtifact(oldPath, newName)
    }
    return httpRequest('POST', '/api/artifacts/rename', { oldPath, newName })
  },

  // Delete a file or folder
  deleteArtifact: async (filePath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.deleteArtifact(filePath)
    }
    return httpRequest('DELETE', `/api/artifacts?path=${encodeURIComponent(filePath)}`)
  },

  // Move a file or folder
  moveArtifact: async (sourcePath: string, targetDir: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.moveArtifact(sourcePath, targetDir)
    }
    return httpRequest('POST', '/api/artifacts/move', { sourcePath, targetDir })
  },

  // Copy a file or folder
  copyArtifact: async (sourcePath: string, targetDir: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.copyArtifact(sourcePath, targetDir)
    }
    return httpRequest('POST', '/api/artifacts/copy', { sourcePath, targetDir })
  },

  // ===== Onboarding =====
  writeOnboardingArtifact: async (
    spaceId: string,
    fileName: string,
    content: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.writeOnboardingArtifact(spaceId, fileName, content)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/onboarding/artifact`, { fileName, content })
  },

  saveOnboardingConversation: async (
    spaceId: string,
    userMessage: string,
    aiResponse: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.saveOnboardingConversation(spaceId, userMessage, aiResponse)
    }
    return httpRequest('POST', `/api/spaces/${spaceId}/onboarding/conversation`, { userMessage, aiResponse })
  },

  // ===== Skills =====
  listSkills: async (
    workDir: string | undefined,
    locale: string | undefined,
    view: ResourceListView
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listSkills(workDir, locale, view)
    }
    const params = new URLSearchParams()
    if (workDir) params.append('workDir', workDir)
    if (locale) params.append('locale', locale)
    params.append('view', view)
    const query = params.toString()
    return httpRequest('GET', `/api/skills${query ? `?${query}` : ''}`)
  },

  getSkillContent: async (name: string, workDir?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getSkillContent(name, workDir)
    }
    const params = new URLSearchParams({ name })
    if (workDir) params.append('workDir', workDir)
    return httpRequest('GET', `/api/skills/content?${params.toString()}`)
  },

  createSkill: async (workDir: string, name: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createSkill(workDir, name, content)
    }
    return httpRequest('POST', '/api/skills', { workDir, name, content })
  },

  createSkillInLibrary: async (name: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createSkillInLibrary(name, content)
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  generateSkillDraft: async (payload: { description: string }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.generateSkillDraft(payload)
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  saveSopSkill: async (payload: {
    workDir: string
    skillName: string
    description?: string
    sopSpec: {
      version: string
      name: string
      steps: Array<{
        id: string
        action: 'navigate' | 'click' | 'fill' | 'select' | 'press_key' | 'wait_for'
        target?: {
          role?: string
          name?: string
          text?: string
          label?: string
          placeholder?: string
          urlPattern?: string
        }
        value?: string
        assertion?: string
        retries: number
      }>
      meta?: Record<string, unknown>
    }
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.saveSopSkill(payload)
    }
    return { success: false, error: 'SOP recording skill save only available in desktop app' }
  },

  updateSkill: async (skillPath: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateSkill(skillPath, content)
    }
    return httpRequest('PUT', '/api/skills', { skillPath, content })
  },

  updateSkillInLibrary: async (skillPath: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateSkillInLibrary(skillPath, content)
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  deleteSkill: async (skillPath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.deleteSkill(skillPath)
    }
    return httpRequest('DELETE', `/api/skills?path=${encodeURIComponent(skillPath)}`)
  },

  deleteSkillFromLibrary: async (skillPath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.deleteSkillFromLibrary(skillPath)
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  setSkillEnabled: async (payload: {
    source: 'app' | 'global' | 'space' | 'installed'
    name: string
    namespace?: string
    enabled: boolean
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.setSkillEnabled(payload)
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  openSkillsLibraryFolder: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.openSkillsLibraryFolder()
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  importSkillToLibrary: async (
    sourcePath: string,
    options?: { overwrite?: boolean }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.importSkillToLibrary(sourcePath, options)
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  showSkillInFolder: async (skillPath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.showSkillInFolder(skillPath)
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  copySkillToSpaceByRef: async (
    ref: Record<string, unknown>,
    workDir: string,
    options?: { overwrite?: boolean }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.copySkillToSpaceByRef(ref, workDir, options)
    }
    return httpRequest('POST', '/api/skills/copy-by-ref', { ref, workDir, options })
  },

  clearSkillsCache: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.clearSkillsCache()
    }
    return httpRequest('POST', '/api/skills/clear-cache')
  },

  refreshSkillsIndex: async (workDir?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.refreshSkillsIndex(workDir)
    }
    return httpRequest('POST', '/api/skills/refresh', { workDir })
  },

  // ===== Agents =====
  listAgents: async (
    workDir: string | undefined,
    locale: string | undefined,
    view: ResourceListView
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listAgents(workDir, locale, view)
    }
    const params = new URLSearchParams()
    if (workDir) params.append('workDir', workDir)
    if (locale) params.append('locale', locale)
    params.append('view', view)
    const query = params.toString()
    return httpRequest('GET', `/api/agents${query ? `?${query}` : ''}`)
  },

  getAgentContent: async (name: string, workDir?: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getAgentContent(name, workDir)
    }
    const params = new URLSearchParams({ name })
    if (workDir) params.append('workDir', workDir)
    return httpRequest('GET', `/api/agents/content?${params.toString()}`)
  },

  createAgent: async (workDir: string, name: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createAgent(workDir, name, content)
    }
    return httpRequest('POST', '/api/agents', { workDir, name, content })
  },

  createAgentInLibrary: async (name: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.createAgentInLibrary(name, content)
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  generateAgentDraft: async (description: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.generateAgentDraft(description)
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  updateAgent: async (agentPath: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateAgent(agentPath, content)
    }
    return httpRequest('PUT', '/api/agents', { agentPath, content })
  },

  updateAgentInLibrary: async (agentPath: string, content: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.updateAgentInLibrary(agentPath, content)
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  deleteAgent: async (agentPath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.deleteAgent(agentPath)
    }
    return httpRequest('DELETE', `/api/agents?path=${encodeURIComponent(agentPath)}`)
  },

  deleteAgentFromLibrary: async (agentPath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.deleteAgentFromLibrary(agentPath)
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  setAgentEnabled: async (payload: {
    source: 'app' | 'global' | 'space' | 'plugin'
    name: string
    namespace?: string
    enabled: boolean
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.setAgentEnabled(payload)
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  openAgentsLibraryFolder: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.openAgentsLibraryFolder()
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  importAgentToLibrary: async (
    sourcePath: string,
    options?: { overwrite?: boolean }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.importAgentToLibrary(sourcePath, options)
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  showAgentInFolder: async (agentPath: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.showAgentInFolder(agentPath)
    }
    return { success: false, error: 'Only available in desktop app' }
  },

  copyAgentToSpaceByRef: async (
    ref: Record<string, unknown>,
    workDir: string,
    options?: { overwrite?: boolean }
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.copyAgentToSpaceByRef(ref, workDir, options)
    }
    return httpRequest('POST', '/api/agents/copy-by-ref', { ref, workDir, options })
  },

  clearAgentsCache: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.clearAgentsCache()
    }
    return httpRequest('POST', '/api/agents/clear-cache')
  },

  // ===== Presets =====
  listPresets: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.listPresets()
    }
    return httpRequest('GET', '/api/presets')
  },

  getPreset: async (presetId: string): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.getPreset(presetId)
    }
    return httpRequest('GET', `/api/presets/${encodeURIComponent(presetId)}`)
  },

  // ===== Remote Access (Electron only) =====
  enableRemoteAccess: async (port?: number): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.enableRemoteAccess(port)
  },

  disableRemoteAccess: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.disableRemoteAccess()
  },

  enableTunnel: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.enableTunnel()
  },

  disableTunnel: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.disableTunnel()
  },

  getRemoteStatus: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.getRemoteStatus()
  },

  getRemoteQRCode: async (includeToken?: boolean): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.getRemoteQRCode(includeToken)
  },

  // ===== System Settings (Electron only) =====
  getAutoLaunch: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.getAutoLaunch()
  },

  setAutoLaunch: async (enabled: boolean): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.setAutoLaunch(enabled)
  },

  getMinimizeToTray: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.getMinimizeToTray()
  },

  setMinimizeToTray: async (enabled: boolean): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.setMinimizeToTray(enabled)
  },

  // ===== Window (Electron only) =====
  setTitleBarOverlay: async (options: {
    color: string
    symbolColor: string
  }): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: true } // No-op in remote mode
    }
    return window.kite.setTitleBarOverlay(options)
  },

  maximizeWindow: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.maximizeWindow()
  },

  unmaximizeWindow: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.unmaximizeWindow()
  },

  isWindowMaximized: async (): Promise<ApiResponse<boolean>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.isWindowMaximized()
  },

  toggleMaximizeWindow: async (): Promise<ApiResponse<boolean>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.toggleMaximizeWindow()
  },

  onWindowMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    if (!isElectron()) {
      return () => {} // No-op in remote mode
    }
    return window.kite.onWindowMaximizeChange(callback)
  },

  // ===== Event Listeners =====
  onAgentRunStart: (callback: (data: unknown) => void) =>
    onEvent('agent:run-start', callback),
  onAgentMessage: (callback: (data: unknown) => void) =>
    onEvent('agent:message', callback),
  onAgentToolCall: (callback: (data: unknown) => void) =>
    onEvent('agent:tool-call', callback),
  onAgentToolResult: (callback: (data: unknown) => void) =>
    onEvent('agent:tool-result', callback),
  onAgentProcess: (callback: (data: unknown) => void) =>
    onEvent('agent:process', callback),
  onAgentError: (callback: (data: unknown) => void) =>
    onEvent('agent:error', callback),
  onAgentComplete: (callback: (data: unknown) => void) =>
    onEvent('agent:complete', callback),
  onAgentMode: (callback: (data: unknown) => void) =>
    onEvent('agent:mode', callback),
  onAgentThought: (callback: (data: unknown) => void) =>
    onEvent('agent:thought', callback),
  onAgentToolsAvailable: (callback: (data: unknown) => void) =>
    onEvent('agent:tools-available', callback),
  onAgentSlashCommands: (callback: (data: unknown) => void) =>
    onEvent('agent:slash-commands', callback),
  onAgentDirectiveResolution: (callback: (data: unknown) => void) =>
    onEvent('agent:directive-resolution', callback),
  onAgentMcpStatus: (callback: (data: unknown) => void) =>
    onEvent('agent:mcp-status', callback),
  onAgentCompact: (callback: (data: unknown) => void) =>
    onEvent('agent:compact', callback),
  onSkillsChanged: (callback: (data: unknown) => void) =>
    onEvent('skills:changed', callback),
  onAgentsChanged: (callback: (data: unknown) => void) =>
    onEvent('agents:changed', callback),
  onRemoteStatusChange: (callback: (data: unknown) => void) =>
    onEvent('remote:status-change', callback),

  // ===== WebSocket Control =====
  connectWebSocket,
  disconnectWebSocket,
  subscribeToConversation,
  unsubscribeFromConversation,

  // Canvas Tab Context Menu (native Electron menu)
  showCanvasTabContextMenu: async (options: {
    tabId: string
    tabIndex: number
    tabTitle: string
    tabPath?: string
    tabCount: number
    hasTabsToRight: boolean
  }): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.showCanvasTabContextMenu(options)
    }
    return { success: false, error: 'Native menu only available in desktop app' }
  },

  onCanvasTabAction: (callback: (data: {
    action: 'close' | 'closeOthers' | 'closeToRight' | 'copyPath' | 'refresh'
    tabId?: string
    tabIndex?: number
    tabPath?: string
  }) => void) =>
    onEvent('canvas:tab-action', callback as (data: unknown) => void),

  // ===== Search =====
  search: async (
    query: string,
    scope: 'conversation' | 'space' | 'global',
    conversationId?: string,
    spaceId?: string
  ): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.search(query, scope, conversationId, spaceId)
    }
    return httpRequest('POST', '/api/search', {
      query,
      scope,
      conversationId,
      spaceId
    })
  },

  cancelSearch: async (): Promise<ApiResponse> => {
    if (isElectron()) {
      return window.kite.cancelSearch()
    }
    return httpRequest('POST', '/api/search/cancel')
  },

  onSearchProgress: (callback: (data: { current: number; total: number; searchId: string }) => void) =>
    onEvent('search:progress', callback),

  onSearchCancelled: (callback: () => void) =>
    onEvent('search:cancelled', callback),

  // ===== Updater (Electron only) =====
  checkForUpdates: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.checkForUpdates()
  },

  installUpdate: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.installUpdate()
  },

  getVersion: async (): Promise<ApiResponse<string>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.getVersion()
  },

  getUpdaterState: async (): Promise<ApiResponse<{
    status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'manual-download' | 'error'
    currentVersion: string
    version?: string | null
    latestVersion?: string | null
    checkTime?: string | null
    message?: string
    percent?: number
    releaseNotes?: string | { version: string; note: string }[]
    downloadSource?: 'github' | 'baidu' | null
    downloadUrl?: string | null
    baiduExtractCode?: string | null
    lastDismissedVersion?: string | null
  }>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.getUpdaterState()
  },

  dismissUpdateVersion: async (version: string): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.dismissUpdateVersion(version)
  },

  onUpdaterStatus: (callback: (data: {
    status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'manual-download' | 'error'
    currentVersion?: string
    version?: string | null
    latestVersion?: string | null
    checkTime?: string | null
    percent?: number
    message?: string
    releaseNotes?: string | { version: string; note: string }[]
    downloadSource?: 'github' | 'baidu' | null
    downloadUrl?: string | null
    baiduExtractCode?: string | null
    lastDismissedVersion?: string | null
  }) => void) => {
    if (!isElectron()) {
      return () => {} // No-op in remote mode
    }
    return window.kite.onUpdaterStatus(callback)
  },

  // ===== Performance Monitoring (Electron only, Developer Tools) =====
  perfStart: async (config?: { sampleInterval?: number; maxSamples?: number }): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.perfStart(config)
  },

  perfStop: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.perfStop()
  },

  perfGetState: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.perfGetState()
  },

  perfGetHistory: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.perfGetHistory()
  },

  perfClearHistory: async (): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.perfClearHistory()
  },

  perfSetConfig: async (config: { enabled?: boolean; sampleInterval?: number; warnOnThreshold?: boolean }): Promise<ApiResponse> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.perfSetConfig(config)
  },

  perfExport: async (): Promise<ApiResponse<string>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.perfExport()
  },

  onPerfSnapshot: (callback: (data: unknown) => void) =>
    onEvent('perf:snapshot', callback),

  onPerfWarning: (callback: (data: unknown) => void) =>
    onEvent('perf:warning', callback),

  // Report renderer metrics to main process (for combined monitoring)
  perfReportRendererMetrics: (metrics: {
    fps: number
    frameTime: number
    renderCount: number
    domNodes: number
    eventListeners: number
    jsHeapUsed: number
    jsHeapLimit: number
    longTasks: number
  }): void => {
    if (isElectron()) {
      window.kite.perfReportRendererMetrics(metrics)
    }
  },

  // ===== Git Bash (Windows only, Electron only) =====
  getGitBashStatus: async (): Promise<ApiResponse<{
    found: boolean
    path: string | null
    source: 'system' | 'app-local' | 'env-var' | null
  }>> => {
    if (!isElectron()) {
      // In remote mode, assume Git Bash is available (server handles it)
      return { success: true, data: { found: true, path: null, source: null } }
    }
    return window.kite.getGitBashStatus()
  },

  installGitBash: async (onProgress: (progress: {
    phase: 'downloading' | 'extracting' | 'configuring' | 'done' | 'error'
    progress: number
    message: string
    error?: string
  }) => void): Promise<{ success: boolean; path?: string; error?: string }> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.installGitBash(onProgress)
  },

  getPythonRuntimeStatus: async (): Promise<ApiResponse<PythonRuntimeStatus>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.getPythonRuntimeStatus()
  },

  installPythonRuntime: async (): Promise<ApiResponse<PythonRuntimeStatus>> => {
    if (!isElectron()) {
      return { success: false, error: 'Only available in desktop app' }
    }
    return window.kite.installPythonRuntime()
  },

  openExternal: async (url: string): Promise<void> => {
    if (!isElectron()) {
      // In remote mode, open in new tab
      window.open(url, '_blank')
      return
    }
    return window.kite.openExternal(url)
  },
}

// Export type for the API
export type KiteApi = typeof api
