/**
 * Preload Script - Exposes IPC to renderer
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { InvocationContext, ResourceListView } from '../shared/resource-access'
import type { LocaleCode } from '../shared/i18n/locale'

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

type ChatMode = 'code' | 'plan'

interface PythonRuntimeStatus {
  found: boolean
  pythonCommand: string | null
  pythonVersion: string | null
  pipReady: boolean
  missingModules: string[]
  installSupported: boolean
  installStrategy: 'windows-system-silent' | 'manual-guidance'
}

// Type definitions for exposed API
export interface KiteAPI {
  // Config
  getConfig: () => Promise<IpcResponse>
  setConfig: (updates: Record<string, unknown>) => Promise<IpcResponse>
  validateApi: (
    apiKey: string,
    apiUrl: string,
    provider: string,
    protocol?: string,
    model?: string
  ) => Promise<IpcResponse>
  startOpenAICodexBrowserAuth: (input: {
    tenantId: string
    redirectUri?: string
    scope?: string
    accountId?: string
  }) => Promise<IpcResponse>
  finishOpenAICodexBrowserAuth: (input: {
    state: string
    code: string
  }) => Promise<IpcResponse>
  startOpenAICodexDeviceAuth: (input: {
    tenantId: string
    scope?: string
    accountId?: string
  }) => Promise<IpcResponse>
  pollOpenAICodexDeviceAuth: (input: {
    deviceCode: string
  }) => Promise<IpcResponse>
  validateOpenAICodexSession: (input: {
    tenantId: string
    accountId?: string
    fallbackAccessToken?: string
    authMode?: 'api_key' | 'oauth_browser' | 'oauth_device'
    modelId?: string
  }) => Promise<IpcResponse>

  // Space
  getKiteSpace: () => Promise<IpcResponse>
  listSpaces: () => Promise<IpcResponse>
  createSpace: (input: { name: string; icon: string; customPath?: string }) => Promise<IpcResponse>
  deleteSpace: (spaceId: string) => Promise<IpcResponse>
  getSpace: (spaceId: string) => Promise<IpcResponse>
  openSpaceFolder: (spaceId: string) => Promise<IpcResponse>
  updateSpace: (spaceId: string, updates: { name?: string; icon?: string }) => Promise<IpcResponse>
  getDefaultSpacePath: () => Promise<IpcResponse>
  selectFolder: () => Promise<IpcResponse>
  selectFiles: () => Promise<IpcResponse<string[]>>
  updateSpacePreferences: (spaceId: string, preferences: {
    layout?: {
      artifactRailExpanded?: boolean
      chatWidth?: number
    }
    skills?: {
      favorites?: string[]
    }
  }) => Promise<IpcResponse>
  getSpacePreferences: (spaceId: string) => Promise<IpcResponse>

  // Conversation
  listConversations: (spaceId: string) => Promise<IpcResponse>
  createConversation: (spaceId: string, title?: string) => Promise<IpcResponse>
  getConversation: (spaceId: string, conversationId: string) => Promise<IpcResponse>
  updateConversation: (
    spaceId: string,
    conversationId: string,
    updates: Record<string, unknown>
  ) => Promise<IpcResponse>
  deleteConversation: (spaceId: string, conversationId: string) => Promise<IpcResponse>
  addMessage: (
    spaceId: string,
    conversationId: string,
    message: { role: string; content: string }
  ) => Promise<IpcResponse>
  updateLastMessage: (
    spaceId: string,
    conversationId: string,
    updates: Record<string, unknown>
  ) => Promise<IpcResponse>

  // Change Sets
  listChangeSets: (spaceId: string, conversationId: string) => Promise<IpcResponse>
  acceptChangeSet: (params: { spaceId: string; conversationId: string; changeSetId: string; filePath?: string }) => Promise<IpcResponse>
  rollbackChangeSet: (params: { spaceId: string; conversationId: string; changeSetId: string; filePath?: string; force?: boolean }) => Promise<IpcResponse>

  // Agent
  sendMessage: (request: {
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
    fileContexts?: Array<{
      id: string
      type: 'file-context'
      path: string
      name: string
      extension: string
    }>
  }) => Promise<IpcResponse>
  setAgentMode: (
    spaceId: string,
    conversationId: string,
    mode: ChatMode,
    runId?: string
  ) => Promise<IpcResponse<{ applied: boolean; mode: ChatMode; runId?: string; reason?: string; error?: string }>>
  guideMessage: (request: GuideMessageRequest) => Promise<IpcResponse<{ delivery: 'session_send' | 'ask_user_question_answer' }>>
  stopGeneration: (spaceId: string, conversationId?: string, opId?: string) => Promise<IpcResponse>
  approveTool: (spaceId: string, conversationId: string, opId?: string) => Promise<IpcResponse>
  rejectTool: (spaceId: string, conversationId: string, opId?: string) => Promise<IpcResponse>
  answerQuestion: (
    spaceId: string,
    conversationId: string,
    answer: string | AskUserQuestionAnswerPayload,
    opId?: string
  ) => Promise<IpcResponse>
  getSessionState: (spaceId: string, conversationId: string) => Promise<IpcResponse>
  ensureSessionWarm: (
    spaceId: string,
    conversationId: string,
    responseLanguage?: LocaleCode | string,
    options?: { waitForReady?: boolean }
  ) => Promise<IpcResponse>
  getAgentResourceHash: (
    params?: { spaceId?: string; workDir?: string; conversationId?: string }
  ) => Promise<IpcResponse>
  testMcpConnections: () => Promise<{ success: boolean; servers: unknown[]; error?: string }>
  reconnectMcpServer: (spaceId: string, conversationId: string, serverName: string, opId?: string) => Promise<{ success: boolean; error?: string; errorCode?: string }>
  toggleMcpServer: (spaceId: string, conversationId: string, serverName: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>

  // Event listeners
  onAgentRunStart: (callback: (data: unknown) => void) => () => void
  onAgentMessage: (callback: (data: unknown) => void) => () => void
  onAgentToolCall: (callback: (data: unknown) => void) => () => void
  onAgentToolResult: (callback: (data: unknown) => void) => () => void
  onAgentProcess: (callback: (data: unknown) => void) => () => void
  onAgentError: (callback: (data: unknown) => void) => () => void
  onAgentComplete: (callback: (data: unknown) => void) => () => void
  onAgentMode: (callback: (data: unknown) => void) => () => void
  onAgentThinking: (callback: (data: unknown) => void) => () => void
  onAgentThought: (callback: (data: unknown) => void) => () => void
  onAgentToolsAvailable: (callback: (data: unknown) => void) => () => void
  onAgentSlashCommands: (callback: (data: unknown) => void) => () => void
  onAgentDirectiveResolution: (callback: (data: unknown) => void) => () => void
  onAgentMcpStatus: (callback: (data: unknown) => void) => () => void
  onAgentCompact: (callback: (data: unknown) => void) => () => void
  onSkillsChanged: (callback: (data: unknown) => void) => () => void
  onAgentsChanged: (callback: (data: unknown) => void) => () => void

  // Artifact
  listArtifacts: (spaceId: string) => Promise<IpcResponse>
  listArtifactsTree: (spaceId: string) => Promise<IpcResponse>
  openArtifact: (filePath: string) => Promise<IpcResponse>
  showArtifactInFolder: (filePath: string) => Promise<IpcResponse>
  readArtifactContent: (filePath: string) => Promise<IpcResponse>
  writeArtifactContent: (filePath: string, content: string) => Promise<IpcResponse>
  createFolder: (folderPath: string) => Promise<IpcResponse>
  createFile: (filePath: string, content?: string) => Promise<IpcResponse>
  createArtifactEntry: (params: {
    type: 'file' | 'folder'
    parentPath: string
    name: string
    content?: string
  }) => Promise<IpcResponse>
  renameArtifact: (oldPath: string, newName: string) => Promise<IpcResponse>
  deleteArtifact: (filePath: string) => Promise<IpcResponse>
  moveArtifact: (sourcePath: string, targetDir: string) => Promise<IpcResponse>
  copyArtifact: (sourcePath: string, targetDir: string) => Promise<IpcResponse>

  // Onboarding
  writeOnboardingArtifact: (spaceId: string, filename: string, content: string) => Promise<IpcResponse>
  saveOnboardingConversation: (spaceId: string, userPrompt: string, aiResponse: string) => Promise<IpcResponse>

  // Skills
  listSkills: (workDir: string | undefined, locale: string | undefined, view: ResourceListView) => Promise<IpcResponse>
  getSkillContent: (name: string, workDir?: string) => Promise<IpcResponse>
  createSkill: (workDir: string, name: string, content: string) => Promise<IpcResponse>
  createSkillInLibrary: (name: string, content: string) => Promise<IpcResponse>
  generateSkillDraft: (payload: {
    description: string
  }) => Promise<IpcResponse>
  saveSopSkill: (payload: {
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
  }) => Promise<IpcResponse>
  updateSkill: (skillPath: string, content: string) => Promise<IpcResponse>
  updateSkillInLibrary: (skillPath: string, content: string) => Promise<IpcResponse>
  deleteSkill: (skillPath: string) => Promise<IpcResponse>
  deleteSkillFromLibrary: (skillPath: string) => Promise<IpcResponse>
  setSkillEnabled: (payload: {
    source: 'app' | 'global' | 'space' | 'installed'
    name: string
    namespace?: string
    enabled: boolean
  }) => Promise<IpcResponse>
  openSkillsLibraryFolder: () => Promise<IpcResponse>
  importSkillToLibrary: (
    sourcePath: string,
    options?: { overwrite?: boolean },
    locale?: string
  ) => Promise<IpcResponse>
  showSkillInFolder: (skillPath: string) => Promise<IpcResponse>
  copySkillToSpaceByRef: (
    ref: Record<string, unknown>,
    workDir: string,
    options?: { overwrite?: boolean }
  ) => Promise<IpcResponse>
  clearSkillsCache: () => Promise<IpcResponse>
  refreshSkillsIndex: (workDir?: string) => Promise<IpcResponse>

  // Agents
  listAgents: (workDir: string | undefined, locale: string | undefined, view: ResourceListView) => Promise<IpcResponse>
  getAgentContent: (name: string, workDir?: string) => Promise<IpcResponse>
  createAgent: (workDir: string, name: string, content: string) => Promise<IpcResponse>
  createAgentInLibrary: (name: string, content: string) => Promise<IpcResponse>
  generateAgentDraft: (description: string) => Promise<IpcResponse>
  updateAgent: (agentPath: string, content: string) => Promise<IpcResponse>
  updateAgentInLibrary: (agentPath: string, content: string) => Promise<IpcResponse>
  deleteAgent: (agentPath: string) => Promise<IpcResponse>
  deleteAgentFromLibrary: (agentPath: string) => Promise<IpcResponse>
  setAgentEnabled: (payload: {
    source: 'app' | 'global' | 'space' | 'plugin'
    name: string
    namespace?: string
    enabled: boolean
  }) => Promise<IpcResponse>
  openAgentsLibraryFolder: () => Promise<IpcResponse>
  importAgentToLibrary: (
    sourcePath: string,
    options?: { overwrite?: boolean },
    locale?: string
  ) => Promise<IpcResponse>
  showAgentInFolder: (agentPath: string) => Promise<IpcResponse>
  copyAgentToSpaceByRef: (
    ref: Record<string, unknown>,
    workDir: string,
    options?: { overwrite?: boolean }
  ) => Promise<IpcResponse>
  clearAgentsCache: () => Promise<IpcResponse>

  // Presets
  listPresets: () => Promise<IpcResponse>
  getPreset: (presetId: string) => Promise<IpcResponse>

  // Remote Access
  enableRemoteAccess: (port?: number) => Promise<IpcResponse>
  disableRemoteAccess: () => Promise<IpcResponse>
  enableTunnel: () => Promise<IpcResponse>
  disableTunnel: () => Promise<IpcResponse>
  getRemoteStatus: () => Promise<IpcResponse>
  getRemoteQRCode: (includeToken?: boolean) => Promise<IpcResponse>
  onRemoteStatusChange: (callback: (data: unknown) => void) => () => void

  // System Settings
  getAutoLaunch: () => Promise<IpcResponse>
  setAutoLaunch: (enabled: boolean) => Promise<IpcResponse>
  getMinimizeToTray: () => Promise<IpcResponse>
  setMinimizeToTray: (enabled: boolean) => Promise<IpcResponse>

  // Window
  setTitleBarOverlay: (options: { color: string; symbolColor: string }) => Promise<IpcResponse>
  maximizeWindow: () => Promise<IpcResponse>
  unmaximizeWindow: () => Promise<IpcResponse>
  isWindowMaximized: () => Promise<IpcResponse<boolean>>
  toggleMaximizeWindow: () => Promise<IpcResponse<boolean>>
  onWindowMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void

  // Search
  search: (
    query: string,
    scope: 'conversation' | 'space' | 'global',
    conversationId?: string,
    spaceId?: string
  ) => Promise<IpcResponse>
  cancelSearch: () => Promise<IpcResponse>
  onSearchProgress: (callback: (data: unknown) => void) => () => void
  onSearchCancelled: (callback: () => void) => () => void

  // Updater
  checkForUpdates: () => Promise<IpcResponse>
  installUpdate: () => Promise<IpcResponse>
  getVersion: () => Promise<IpcResponse<string>>
  getUpdaterState: () => Promise<IpcResponse>
  dismissUpdateVersion: (version: string) => Promise<IpcResponse>
  onUpdaterStatus: (callback: (data: unknown) => void) => () => void

  // Canvas Tab Menu
  showCanvasTabContextMenu: (options: {
    tabId: string
    tabIndex: number
    tabTitle: string
    tabPath?: string
    tabCount: number
    hasTabsToRight: boolean
  }) => Promise<IpcResponse>
  onCanvasTabAction: (callback: (data: {
    action: 'close' | 'closeOthers' | 'closeToRight' | 'copyPath' | 'refresh'
    tabId?: string
    tabIndex?: number
    tabPath?: string
  }) => void) => () => void

  // Performance Monitoring (Developer Tools)
  perfStart: (config?: { sampleInterval?: number; maxSamples?: number }) => Promise<IpcResponse>
  perfStop: () => Promise<IpcResponse>
  perfGetState: () => Promise<IpcResponse>
  perfGetHistory: () => Promise<IpcResponse>
  perfClearHistory: () => Promise<IpcResponse>
  perfSetConfig: (config: { enabled?: boolean; sampleInterval?: number; warnOnThreshold?: boolean }) => Promise<IpcResponse>
  perfExport: () => Promise<IpcResponse<string>>
  perfReportRendererMetrics: (metrics: {
    fps: number
    frameTime: number
    renderCount: number
    domNodes: number
    eventListeners: number
    jsHeapUsed: number
    jsHeapLimit: number
    longTasks: number
  }) => void
  onPerfSnapshot: (callback: (data: unknown) => void) => () => void
  onPerfWarning: (callback: (data: unknown) => void) => () => void

  // Git Bash (Windows only)
  getGitBashStatus: () => Promise<IpcResponse<{
    found: boolean
    path: string | null
    source: 'system' | 'app-local' | 'env-var' | null
  }>>
  installGitBash: (onProgress: (progress: {
    phase: 'downloading' | 'extracting' | 'configuring' | 'done' | 'error'
    progress: number
    message: string
    error?: string
  }) => void) => Promise<{ success: boolean; path?: string; error?: string }>
  getPythonRuntimeStatus: () => Promise<IpcResponse<PythonRuntimeStatus>>
  installPythonRuntime: () => Promise<IpcResponse<PythonRuntimeStatus>>
  openExternal: (url: string) => Promise<void>
}

interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  errorCode?: string
}

// Create event listener with cleanup
function createEventListener(channel: string, callback: (data: unknown) => void): () => void {
  console.log(`[Preload] Creating event listener for channel: ${channel}`)

  const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
    console.log(`[Preload] Received event on channel: ${channel}`, data)
    callback(data)
  }

  ipcRenderer.on(channel, handler)

  return () => {
    console.log(`[Preload] Removing event listener for channel: ${channel}`)
    ipcRenderer.removeListener(channel, handler)
  }
}

// Generic IPC invoke with progress callback
async function invokeWithProgress<TResult, TProgress>(
  channel: string,
  request: Record<string, unknown>,
  onProgress: (progress: TProgress) => void,
  progressChannelPrefix: string
): Promise<TResult> {
  const progressChannel = `${progressChannelPrefix}-${Date.now()}`
  const progressHandler = (_event: Electron.IpcRendererEvent, progress: unknown) => {
    onProgress(progress as TProgress)
  }
  ipcRenderer.on(progressChannel, progressHandler)
  try {
    const result = await ipcRenderer.invoke(channel, { ...request, progressChannel })
    return result as TResult
  } finally {
    ipcRenderer.removeListener(progressChannel, progressHandler)
  }
}

// Expose API to renderer
const api: KiteAPI = {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (updates) => ipcRenderer.invoke('config:set', updates),
  validateApi: (apiKey, apiUrl, provider, protocol, model) =>
    ipcRenderer.invoke('config:validate-api', apiKey, apiUrl, provider, protocol, model),
  startOpenAICodexBrowserAuth: (input) =>
    ipcRenderer.invoke('config:openai-codex:start-browser-auth', input),
  finishOpenAICodexBrowserAuth: (input) =>
    ipcRenderer.invoke('config:openai-codex:finish-browser-auth', input),
  startOpenAICodexDeviceAuth: (input) =>
    ipcRenderer.invoke('config:openai-codex:start-device-auth', input),
  pollOpenAICodexDeviceAuth: (input) =>
    ipcRenderer.invoke('config:openai-codex:poll-device-auth', input),
  validateOpenAICodexSession: (input) =>
    ipcRenderer.invoke('config:openai-codex:validate-session', input),

  // Space
  getKiteSpace: () => ipcRenderer.invoke('space:get-kite'),
  listSpaces: () => ipcRenderer.invoke('space:list'),
  createSpace: (input) => ipcRenderer.invoke('space:create', input),
  deleteSpace: (spaceId) => ipcRenderer.invoke('space:delete', spaceId),
  getSpace: (spaceId) => ipcRenderer.invoke('space:get', spaceId),
  openSpaceFolder: (spaceId) => ipcRenderer.invoke('space:open-folder', spaceId),
  updateSpace: (spaceId, updates) => ipcRenderer.invoke('space:update', spaceId, updates),
  getDefaultSpacePath: () => ipcRenderer.invoke('space:get-default-path'),
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  selectFiles: () => ipcRenderer.invoke('dialog:select-files'),
  updateSpacePreferences: (spaceId, preferences) =>
    ipcRenderer.invoke('space:update-preferences', spaceId, preferences),
  getSpacePreferences: (spaceId) => ipcRenderer.invoke('space:get-preferences', spaceId),

  // Conversation
  listConversations: (spaceId) => ipcRenderer.invoke('conversation:list', spaceId),
  createConversation: (spaceId, title) => ipcRenderer.invoke('conversation:create', spaceId, title),
  getConversation: (spaceId, conversationId) =>
    ipcRenderer.invoke('conversation:get', spaceId, conversationId),
  updateConversation: (spaceId, conversationId, updates) =>
    ipcRenderer.invoke('conversation:update', spaceId, conversationId, updates),
  deleteConversation: (spaceId, conversationId) =>
    ipcRenderer.invoke('conversation:delete', spaceId, conversationId),
  addMessage: (spaceId, conversationId, message) =>
    ipcRenderer.invoke('conversation:add-message', spaceId, conversationId, message),
  updateLastMessage: (spaceId, conversationId, updates) =>
    ipcRenderer.invoke('conversation:update-last-message', spaceId, conversationId, updates),

  // Change Sets
  listChangeSets: (spaceId, conversationId) =>
    ipcRenderer.invoke('change-set:list', spaceId, conversationId),
  acceptChangeSet: (params) => ipcRenderer.invoke('change-set:accept', params),
  rollbackChangeSet: (params) => ipcRenderer.invoke('change-set:rollback', params),

  // Agent
  sendMessage: (request) => ipcRenderer.invoke('agent:send-message', request),
  setAgentMode: (spaceId, conversationId, mode, runId) =>
    ipcRenderer.invoke('agent:set-mode', { spaceId, conversationId, mode, runId }),
  guideMessage: (request) => ipcRenderer.invoke('agent:guide-message', request),
  stopGeneration: (spaceId, conversationId, opId) => ipcRenderer.invoke('agent:stop', { spaceId, conversationId, opId }),
  approveTool: (spaceId, conversationId, opId) => ipcRenderer.invoke('agent:approve-tool', { spaceId, conversationId, opId }),
  rejectTool: (spaceId, conversationId, opId) => ipcRenderer.invoke('agent:reject-tool', { spaceId, conversationId, opId }),
  answerQuestion: (spaceId, conversationId, answer, opId) =>
    ipcRenderer.invoke('agent:answer-question', { spaceId, conversationId, answer, opId }),
  getSessionState: (spaceId, conversationId) => ipcRenderer.invoke('agent:get-session-state', { spaceId, conversationId }),
  ensureSessionWarm: (spaceId, conversationId, responseLanguage, options) =>
    ipcRenderer.invoke('agent:ensure-session-warm', spaceId, conversationId, responseLanguage, options),
  getAgentResourceHash: (params) => ipcRenderer.invoke('agent:get-resource-hash', params),
  testMcpConnections: () => ipcRenderer.invoke('agent:test-mcp'),
  reconnectMcpServer: (spaceId, conversationId, serverName, opId) =>
    ipcRenderer.invoke('agent:reconnect-mcp', { spaceId, conversationId, serverName, opId }),
  toggleMcpServer: (spaceId, conversationId, serverName, enabled) =>
    ipcRenderer.invoke('agent:toggle-mcp', { spaceId, conversationId, serverName, enabled }),

  // Event listeners
  onAgentRunStart: (callback) => createEventListener('agent:run-start', callback),
  onAgentMessage: (callback) => createEventListener('agent:message', callback),
  onAgentToolCall: (callback) => createEventListener('agent:tool-call', callback),
  onAgentToolResult: (callback) => createEventListener('agent:tool-result', callback),
  onAgentProcess: (callback) => createEventListener('agent:process', callback),
  onAgentError: (callback) => createEventListener('agent:error', callback),
  onAgentComplete: (callback) => createEventListener('agent:complete', callback),
  onAgentMode: (callback) => createEventListener('agent:mode', callback),
  onAgentThinking: (callback) => createEventListener('agent:thinking', callback),
  onAgentThought: (callback) => createEventListener('agent:thought', callback),
  onAgentToolsAvailable: (callback) => createEventListener('agent:tools-available', callback),
  onAgentSlashCommands: (callback) => createEventListener('agent:slash-commands', callback),
  onAgentDirectiveResolution: (callback) => createEventListener('agent:directive-resolution', callback),
  onAgentMcpStatus: (callback) => createEventListener('agent:mcp-status', callback),
  onAgentCompact: (callback) => createEventListener('agent:compact', callback),
  onSkillsChanged: (callback) => createEventListener('skills:changed', callback),
  onAgentsChanged: (callback) => createEventListener('agents:changed', callback),

  // Artifact
  listArtifacts: (spaceId) => ipcRenderer.invoke('artifact:list', spaceId),
  listArtifactsTree: (spaceId) => ipcRenderer.invoke('artifact:list-tree', spaceId),
  openArtifact: (filePath) => ipcRenderer.invoke('artifact:open', filePath),
  showArtifactInFolder: (filePath) => ipcRenderer.invoke('artifact:show-in-folder', filePath),
  readArtifactContent: (filePath) => ipcRenderer.invoke('artifact:read-content', filePath),
  writeArtifactContent: (filePath, content) => ipcRenderer.invoke('artifact:write-content', filePath, content),
  createFolder: (folderPath) => ipcRenderer.invoke('artifact:create-folder', folderPath),
  createFile: (filePath, content) => ipcRenderer.invoke('artifact:create-file', filePath, content),
  createArtifactEntry: (params) => ipcRenderer.invoke('artifact:create-entry', params),
  renameArtifact: (oldPath, newName) => ipcRenderer.invoke('artifact:rename', oldPath, newName),
  deleteArtifact: (filePath) => ipcRenderer.invoke('artifact:delete', filePath),
  moveArtifact: (sourcePath, targetDir) => ipcRenderer.invoke('artifact:move', sourcePath, targetDir),
  copyArtifact: (sourcePath, targetDir) => ipcRenderer.invoke('artifact:copy', sourcePath, targetDir),

  // Onboarding
  writeOnboardingArtifact: (spaceId, filename, content) =>
    ipcRenderer.invoke('onboarding:write-artifact', spaceId, filename, content),
  saveOnboardingConversation: (spaceId, userPrompt, aiResponse) =>
    ipcRenderer.invoke('onboarding:save-conversation', spaceId, userPrompt, aiResponse),

  // Skills
  listSkills: (workDir, locale, view) => ipcRenderer.invoke('skills:list', workDir, locale, view),
  getSkillContent: (name, workDir) => ipcRenderer.invoke('skills:get-content', name, workDir),
  createSkill: (workDir, name, content) => ipcRenderer.invoke('skills:create', workDir, name, content),
  createSkillInLibrary: (name, content) => ipcRenderer.invoke('skills:create-library', name, content),
  generateSkillDraft: (payload) => ipcRenderer.invoke('skills:generate-draft', payload),
  saveSopSkill: (payload) => ipcRenderer.invoke('skills:save-sop-recording', payload),
  updateSkill: (skillPath, content) => ipcRenderer.invoke('skills:update', skillPath, content),
  updateSkillInLibrary: (skillPath, content) => ipcRenderer.invoke('skills:update-library', skillPath, content),
  deleteSkill: (skillPath) => ipcRenderer.invoke('skills:delete', skillPath),
  deleteSkillFromLibrary: (skillPath) => ipcRenderer.invoke('skills:delete-library', skillPath),
  setSkillEnabled: (payload) => ipcRenderer.invoke('skills:set-enabled', payload),
  openSkillsLibraryFolder: () => ipcRenderer.invoke('skills:open-library-folder'),
  importSkillToLibrary: (sourcePath, options, locale) => ipcRenderer.invoke('skills:import-from-path', sourcePath, options, locale),
  showSkillInFolder: (skillPath) => ipcRenderer.invoke('skills:show-item-in-folder', skillPath),
  copySkillToSpaceByRef: (ref, workDir, options) => ipcRenderer.invoke('skills:copy-to-space-by-ref', ref, workDir, options),
  clearSkillsCache: () => ipcRenderer.invoke('skills:clear-cache'),
  refreshSkillsIndex: (workDir) => ipcRenderer.invoke('skills:refresh', workDir),

  // Agents
  listAgents: (workDir, locale, view) => ipcRenderer.invoke('agents:list', workDir, locale, view),
  getAgentContent: (name, workDir) => ipcRenderer.invoke('agents:get-content', name, workDir),
  createAgent: (workDir, name, content) => ipcRenderer.invoke('agents:create', workDir, name, content),
  createAgentInLibrary: (name, content) => ipcRenderer.invoke('agents:create-library', name, content),
  generateAgentDraft: (description) => ipcRenderer.invoke('agents:generate-draft', description),
  updateAgent: (agentPath, content) => ipcRenderer.invoke('agents:update', agentPath, content),
  updateAgentInLibrary: (agentPath, content) => ipcRenderer.invoke('agents:update-library', agentPath, content),
  deleteAgent: (agentPath) => ipcRenderer.invoke('agents:delete', agentPath),
  deleteAgentFromLibrary: (agentPath) => ipcRenderer.invoke('agents:delete-library', agentPath),
  setAgentEnabled: (payload) => ipcRenderer.invoke('agents:set-enabled', payload),
  openAgentsLibraryFolder: () => ipcRenderer.invoke('agents:open-library-folder'),
  importAgentToLibrary: (sourcePath, options, locale) => ipcRenderer.invoke('agents:import-from-path', sourcePath, options, locale),
  showAgentInFolder: (agentPath) => ipcRenderer.invoke('agents:show-item-in-folder', agentPath),
  copyAgentToSpaceByRef: (ref, workDir, options) => ipcRenderer.invoke('agents:copy-to-space-by-ref', ref, workDir, options),
  clearAgentsCache: () => ipcRenderer.invoke('agents:clear-cache'),

  // Presets
  listPresets: () => ipcRenderer.invoke('preset:list'),
  getPreset: (presetId) => ipcRenderer.invoke('preset:get', presetId),

  // Remote Access
  enableRemoteAccess: (port) => ipcRenderer.invoke('remote:enable', port),
  disableRemoteAccess: () => ipcRenderer.invoke('remote:disable'),
  enableTunnel: () => ipcRenderer.invoke('remote:tunnel:enable'),
  disableTunnel: () => ipcRenderer.invoke('remote:tunnel:disable'),
  getRemoteStatus: () => ipcRenderer.invoke('remote:status'),
  getRemoteQRCode: (includeToken) => ipcRenderer.invoke('remote:qrcode', includeToken),
  onRemoteStatusChange: (callback) => createEventListener('remote:status-change', callback),

  // System Settings
  getAutoLaunch: () => ipcRenderer.invoke('system:get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('system:set-auto-launch', enabled),
  getMinimizeToTray: () => ipcRenderer.invoke('system:get-minimize-to-tray'),
  setMinimizeToTray: (enabled) => ipcRenderer.invoke('system:set-minimize-to-tray', enabled),

  // Window
  setTitleBarOverlay: (options) => ipcRenderer.invoke('window:set-title-bar-overlay', options),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  unmaximizeWindow: () => ipcRenderer.invoke('window:unmaximize'),
  isWindowMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  onWindowMaximizeChange: (callback) => createEventListener('window:maximize-change', callback as (data: unknown) => void),

  // Search
  search: (query, scope, conversationId, spaceId) =>
    ipcRenderer.invoke('search:execute', query, scope, conversationId, spaceId),
  cancelSearch: () => ipcRenderer.invoke('search:cancel'),
  onSearchProgress: (callback) => createEventListener('search:progress', callback),
  onSearchCancelled: (callback) => createEventListener('search:cancelled', callback),

  // Updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  getVersion: () => ipcRenderer.invoke('updater:get-version'),
  getUpdaterState: () => ipcRenderer.invoke('updater:get-state'),
  dismissUpdateVersion: (version) => ipcRenderer.invoke('updater:dismiss-version', version),
  onUpdaterStatus: (callback) => createEventListener('updater:status', callback),

  // Canvas Tab Menu (native Electron menu)
  showCanvasTabContextMenu: (options) => ipcRenderer.invoke('canvas:show-tab-context-menu', options),
  onCanvasTabAction: (callback) => createEventListener('canvas:tab-action', callback as (data: unknown) => void),

  // Performance Monitoring (Developer Tools)
  perfStart: (config) => ipcRenderer.invoke('perf:start', config),
  perfStop: () => ipcRenderer.invoke('perf:stop'),
  perfGetState: () => ipcRenderer.invoke('perf:get-state'),
  perfGetHistory: () => ipcRenderer.invoke('perf:get-history'),
  perfClearHistory: () => ipcRenderer.invoke('perf:clear-history'),
  perfSetConfig: (config) => ipcRenderer.invoke('perf:set-config', config),
  perfExport: () => ipcRenderer.invoke('perf:export'),
  perfReportRendererMetrics: (metrics) => ipcRenderer.send('perf:renderer-metrics', metrics),
  onPerfSnapshot: (callback) => createEventListener('perf:snapshot', callback),
  onPerfWarning: (callback) => createEventListener('perf:warning', callback),

  // Git Bash (Windows only)
  getGitBashStatus: () => ipcRenderer.invoke('git-bash:status'),
  installGitBash: (onProgress) =>
    invokeWithProgress<
      { success: boolean; path?: string; error?: string },
      Parameters<typeof onProgress>[0]
    >('git-bash:install', {}, onProgress, 'git-bash:install-progress'),
  getPythonRuntimeStatus: () => ipcRenderer.invoke('runtime:python-status'),
  installPythonRuntime: () => ipcRenderer.invoke('runtime:python-install'),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
}

contextBridge.exposeInMainWorld('kite', api)

// Analytics: Listen for tracking events from main process
// Baidu Tongji SDK is loaded in index.html, we just need to call _hmt.push()
// Note: _hmt is initialized as an array in index.html before SDK loads
// The SDK will process queued commands when it loads
ipcRenderer.on('analytics:track', (_event, data: {
  type: string
  category: string
  action: string
  label?: string
  value?: number
  customVars?: Record<string, unknown>
}) => {
  try {
    // _hmt is defined in index.html as: var _hmt = _hmt || []
    // We can push commands to it before SDK fully loads - SDK will process them
    const win = window as unknown as { _hmt?: unknown[][] }

    // Ensure _hmt exists
    if (!win._hmt) {
      win._hmt = []
    }

    if (data.type === 'trackEvent') {
      // _hmt.push(['_trackEvent', category, action, opt_label, opt_value])
      win._hmt.push(['_trackEvent', data.category, data.action, data.label || '', data.value || 0])
      console.log('[Analytics] Baidu event queued:', data.action)
    }
  } catch (error) {
    console.warn('[Analytics] Failed to track Baidu event:', error)
  }
})

// Expose platform info for cross-platform UI adjustments
const platformInfo = {
  platform: process.platform as 'darwin' | 'win32' | 'linux',
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux'
}

contextBridge.exposeInMainWorld('platform', platformInfo)

// Expose minimal electron IPC bridge for compatibility fallbacks
const electronAPI = {
  ipcRenderer: {
    on: (channel: string, callback: (...args: unknown[]) => void) => {
      ipcRenderer.on(channel, (_event, ...args) => callback(...args))
    },
    removeListener: (channel: string, callback: (...args: unknown[]) => void) => {
      ipcRenderer.removeListener(channel, callback as (...args: unknown[]) => void)
    },
    send: (channel: string, ...args: unknown[]) => {
      ipcRenderer.send(channel, ...args)
    }
  }
}

contextBridge.exposeInMainWorld('electron', electronAPI)

// TypeScript declaration for window.kite and window.platform
declare global {
  interface Window {
    kite: KiteAPI
    platform: {
      platform: 'darwin' | 'win32' | 'linux'
      isMac: boolean
      isWindows: boolean
      isLinux: boolean
    }
    // Minimal fallback bridge
    electron?: {
      ipcRenderer: {
        on: (channel: string, callback: (...args: unknown[]) => void) => void
        removeListener: (channel: string, callback: (...args: unknown[]) => void) => void
        send: (channel: string, ...args: unknown[]) => void
      }
    }
  }
}
