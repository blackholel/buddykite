/**
 * Canvas Lifecycle Manager - Centralized Tab Management
 *
 * This class manages canvas tabs in an imperative, predictable manner.
 * Embedded browser views have been fully removed.
 */

import { api } from '../api'
import type { TemplateLibraryTab } from '../types/template-library'

// ============================================
// Types
// ============================================

export type ContentType =
  | 'code'
  | 'markdown'
  | 'plan'
  | 'html'
  | 'image'
  | 'pdf'
  | 'text'
  | 'json'
  | 'csv'
  | 'terminal'
  | 'chat'
  | 'template-library'

export interface TabState {
  id: string
  type: ContentType
  title: string
  spaceLabel?: string
  path?: string
  url?: string
  content?: string
  language?: string
  mimeType?: string
  isDirty: boolean
  isLoading: boolean
  error?: string
  scrollPosition?: number
  lastActiveAt?: number
  // Session-bound tab fields (used by chat tabs and plan tabs)
  conversationId?: string
  spaceId?: string
  workDir?: string
  templateLibraryTab?: TemplateLibraryTab
}

export interface SpaceSessionState {
  spaceId: string
  tabs: TabState[]
  activeTabId: string | null
  lastVisitedAt: number
}

// Callback types
type TabsChangeCallback = (tabs: TabState[]) => void
type ActiveTabChangeCallback = (tabId: string | null) => void
type OpenStateChangeCallback = (isOpen: boolean) => void

// ============================================
// Utility Functions
// ============================================

/**
 * Detect content type from file extension
 */
function detectContentType(path: string): { type: ContentType; language?: string } {
  const ext = path.split('.').pop()?.toLowerCase() || ''

  const codeExtensions: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    go: 'go',
    rs: 'rust',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'c',
    hpp: 'cpp',
    cs: 'csharp',
    swift: 'swift',
    kt: 'kotlin',
    php: 'php',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    sql: 'sql',
    yaml: 'yaml',
    yml: 'yaml',
    xml: 'xml',
    vue: 'vue',
    svelte: 'svelte',
  }

  if (codeExtensions[ext]) {
    return { type: 'code', language: codeExtensions[ext] }
  }

  switch (ext) {
    case 'md':
    case 'markdown':
      return { type: 'markdown', language: 'markdown' }
    case 'html':
    case 'htm':
      return { type: 'html', language: 'html' }
    case 'css':
    case 'scss':
    case 'less':
      return { type: 'code', language: 'css' }
    case 'json':
      return { type: 'json', language: 'json' }
    case 'csv':
      return { type: 'csv' }
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'ico':
    case 'bmp':
      return { type: 'image' }
    case 'pdf':
      return { type: 'pdf' }
    case 'txt':
    case 'log':
    case 'env':
      return { type: 'text' }
    default:
      return { type: 'text' }
  }
}

/**
 * Generate a unique tab ID
 */
function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Extract filename from path
 */
function getFileName(path: string): string {
  return path.split('/').pop() || path
}

function normalizePath(path: string): string {
  const unixPath = path.replace(/\\/g, '/')
  const isAbsolute = unixPath.startsWith('/')
  const segments = unixPath.split('/')
  const normalized: string[] = []

  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue
    }
    if (segment === '..') {
      if (normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
        normalized.pop()
      } else if (!isAbsolute) {
        normalized.push('..')
      }
      continue
    }
    normalized.push(segment)
  }

  const joined = normalized.join('/')
  if (isAbsolute) {
    return `/${joined}` || '/'
  }
  return joined || '.'
}

// ============================================
// CanvasLifecycle Class
// ============================================

class CanvasLifecycle {
  private static readonly MAX_TABS = 5

  // Core state
  private spaceSessions: Map<string, SpaceSessionState> = new Map()
  private currentSpaceId: string | null = null
  private activeTabId: string | null = null
  private isOpen: boolean = false
  private isTransitioning: boolean = false

  // Callback subscriptions
  private tabsChangeCallbacks: Set<TabsChangeCallback> = new Set()
  private activeTabChangeCallbacks: Set<ActiveTabChangeCallback> = new Set()
  private openStateChangeCallbacks: Set<OpenStateChangeCallback> = new Set()

  // Track if already initialized
  private initialized: boolean = false

  initialize(): void {
    if (this.initialized) {
      return
    }
    this.initialized = true
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    void this.closeAll()
  }

  private createSession(spaceId: string): SpaceSessionState {
    return {
      spaceId,
      tabs: [],
      activeTabId: null,
      lastVisitedAt: Date.now(),
    }
  }

  private getOrCreateSession(spaceId: string): SpaceSessionState {
    const existing = this.spaceSessions.get(spaceId)
    if (existing) {
      return existing
    }
    const session = this.createSession(spaceId)
    this.spaceSessions.set(spaceId, session)
    return session
  }

  private getCurrentSession(): SpaceSessionState | undefined {
    if (!this.currentSpaceId) {
      return undefined
    }
    return this.spaceSessions.get(this.currentSpaceId)
  }

  private ensureCurrentSession(): SpaceSessionState {
    const spaceId = this.currentSpaceId ?? 'default-space'
    if (!this.currentSpaceId) {
      this.currentSpaceId = spaceId
    }
    return this.getOrCreateSession(spaceId)
  }

  private findTabById(tabId: string): { session: SpaceSessionState; tab: TabState } | undefined {
    for (const session of this.spaceSessions.values()) {
      const tab = session.tabs.find((item) => item.id === tabId)
      if (tab) {
        return { session, tab }
      }
    }
    return undefined
  }

  private getCurrentSessionTab(tabId: string): TabState | undefined {
    return this.getCurrentSession()?.tabs.find((tab) => tab.id === tabId)
  }

  private syncActiveTabFromCurrentSession(): void {
    const session = this.getCurrentSession()
    this.activeTabId = session?.activeTabId ?? null
  }

  private maybeCloseCanvasForCurrentSession(): void {
    const visibleTabs = this.getVisibleTabs()
    if (visibleTabs.length === 0) {
      this.setOpen(false)
    }
  }

  private removeTabFromSession(session: SpaceSessionState, tabId: string): void {
    const tabIndex = session.tabs.findIndex((tab) => tab.id === tabId)
    if (tabIndex < 0) {
      return
    }
    const previousActiveTabId = session.activeTabId

    session.tabs.splice(tabIndex, 1)

    if (session.activeTabId === tabId) {
      const nextActive = session.tabs[session.tabs.length - 1]
      session.activeTabId = nextActive?.id ?? null
    }

    if (this.currentSpaceId === session.spaceId) {
      this.syncActiveTabFromCurrentSession()
      if (previousActiveTabId !== session.activeTabId) {
        this.notifyActiveTabChange()
      }
      this.maybeCloseCanvasForCurrentSession()
      this.notifyTabsChange()
    }
  }

  private enforceMaxTabs(session: SpaceSessionState): void {
    if (session.tabs.length < CanvasLifecycle.MAX_TABS) {
      return
    }

    const sortable = session.tabs
      .map((tab) => ({ id: tab.id, lastActiveAt: tab.lastActiveAt || 0 }))
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)

    const nonActive = sortable.find((item) => item.id !== session.activeTabId)
    const tabToCloseId = nonActive?.id || sortable[0]?.id
    if (!tabToCloseId) {
      return
    }

    this.removeTabFromSession(session, tabToCloseId)
  }

  // ============================================
  // Space Session Management
  // ============================================

  async switchSpaceSession(spaceId: string): Promise<void> {
    const session = this.getOrCreateSession(spaceId)
    this.currentSpaceId = spaceId
    session.lastVisitedAt = Date.now()
    this.syncActiveTabFromCurrentSession()

    if (session.tabs.length > 0) {
      this.setOpen(true)
    } else {
      this.setOpen(false)
    }

    this.notifyTabsChange()
    this.notifyActiveTabChange()
  }

  getVisibleTabs(): TabState[] {
    const session = this.getCurrentSession()
    return session ? [...session.tabs] : []
  }

  getSpaceSession(spaceId: string): SpaceSessionState | undefined {
    const session = this.spaceSessions.get(spaceId)
    if (!session) {
      return undefined
    }
    return {
      spaceId: session.spaceId,
      tabs: [...session.tabs],
      activeTabId: session.activeTabId,
      lastVisitedAt: session.lastVisitedAt,
    }
  }

  // ============================================
  // Tab Management
  // ============================================

  /**
   * Open a file in the canvas
   */
  async openFile(spaceId: string, path: string, title?: string): Promise<string> {
    await this.switchSpaceSession(spaceId)
    const session = this.getOrCreateSession(spaceId)
    const normalizedPath = normalizePath(path)

    const existing = session.tabs.find((tab) => tab.path && normalizePath(tab.path) === normalizedPath)
    if (existing) {
      await this.switchTab(existing.id)
      return existing.id
    }

    // Detect content type
    const { type, language } = detectContentType(path)

    // PDF files are opened in system default app
    if (type === 'pdf') {
      return this.openPdf(path, title)
    }

    this.enforceMaxTabs(session)

    // Create new tab
    const tabId = generateTabId()
    const tab: TabState = {
      id: tabId,
      type,
      title: title || getFileName(path),
      path,
      language,
      spaceId,
      isDirty: false,
      isLoading: true,
    }

    session.tabs.push(tab)
    session.activeTabId = tabId
    this.activeTabId = tabId
    this.setOpen(true)
    this.notifyTabsChange()

    // Switch to new tab
    await this.switchTab(tabId)

    // Load content (async)
    void this.loadFileContent(tabId, path, type)

    return tabId
  }

  /**
   * Open a PDF file in external app.
   */
  private async openPdf(path: string, title?: string): Promise<string> {
    try {
      const response = await api.openArtifact(path)
      if (!response.success) {
        throw new Error(response.error || 'Failed to open pdf externally')
      }
    } catch (error) {
      console.error('[CanvasLifecycle] Failed to open pdf externally:', { path, title, error })
      throw error
    }
    return `external-pdf-${Date.now()}`
  }

  /**
   * Load file content asynchronously
   */
  private async loadFileContent(tabId: string, path: string, type: ContentType): Promise<void> {
    const tabEntry = this.findTabById(tabId)
    if (!tabEntry) return

    // Images use kite-file:// protocol directly (no content loading needed)
    if (type === 'image') {
      tabEntry.tab.isLoading = false
      this.notifyTabsChange()
      return
    }

    try {
      const response = await api.readArtifactContent(path)

      // Tab might have been closed during async operation
      const currentTabEntry = this.findTabById(tabId)
      if (!currentTabEntry) return

      if (response.success && response.data) {
        const data = response.data as { content: string; mimeType?: string }
        currentTabEntry.tab.content = data.content
        currentTabEntry.tab.mimeType = data.mimeType
        currentTabEntry.tab.isLoading = false
        currentTabEntry.tab.error = undefined
      } else {
        throw new Error(response.error || 'Failed to read file')
      }
    } catch (error) {
      const currentTabEntry = this.findTabById(tabId)
      if (currentTabEntry) {
        currentTabEntry.tab.isLoading = false
        currentTabEntry.tab.error = (error as Error).message
      }
    }

    this.notifyTabsChange()
  }

  /**
   * Open URL in external browser.
   */
  async openUrl(url: string, title?: string): Promise<string> {
    try {
      await api.openExternal(url)
    } catch (error) {
      console.error('[CanvasLifecycle] Failed to open external url:', { url, title, error })
      throw error
    }
    return `external-${Date.now()}`
  }

  /**
   * Open content directly (for dynamically generated content)
   */
  async openContent(
    content: string,
    title: string,
    type: ContentType,
    language?: string
  ): Promise<string> {
    const session = this.ensureCurrentSession()
    this.enforceMaxTabs(session)

    const tabId = generateTabId()
    const tab: TabState = {
      id: tabId,
      type,
      title,
      content,
      language,
      spaceId: session.spaceId,
      isDirty: false,
      isLoading: false,
    }

    session.tabs.push(tab)
    session.activeTabId = tabId
    this.activeTabId = tabId
    this.setOpen(true)
    this.notifyTabsChange()

    await this.switchTab(tabId)

    return tabId
  }

  /**
   * Open a plan tab bound to a specific space/conversation
   * Reuses existing plan tab for the same conversation when possible
   */
  async openPlan(
    content: string,
    title: string,
    spaceId: string,
    conversationId: string,
    workDir?: string
  ): Promise<string> {
    await this.switchSpaceSession(spaceId)
    const session = this.getOrCreateSession(spaceId)

    const existing = session.tabs.find(
      (tab) => tab.type === 'plan' && tab.conversationId === conversationId
    )

    if (existing) {
      this.setOpen(true)

      // If user has local edits, keep local content
      if (existing.isDirty) {
        await this.switchTab(existing.id)
        return existing.id
      }

      existing.content = content
      existing.title = title
      existing.language = 'markdown'
      existing.workDir = workDir ?? existing.workDir
      existing.isDirty = false
      existing.error = undefined
      this.notifyTabsChange()
      await this.switchTab(existing.id)
      return existing.id
    }

    this.enforceMaxTabs(session)

    // Create new plan tab
    const tabId = generateTabId()
    const tab: TabState = {
      id: tabId,
      type: 'plan',
      title,
      content,
      language: 'markdown',
      conversationId,
      spaceId,
      workDir,
      isDirty: false,
      isLoading: false,
    }

    session.tabs.push(tab)
    session.activeTabId = tabId
    this.activeTabId = tabId
    this.setOpen(true)
    this.notifyTabsChange()

    await this.switchTab(tabId)

    return tabId
  }

  /**
   * Open a chat conversation in a tab
   * Allows multiple conversations to be open simultaneously
   */
  async openChat(
    spaceId: string,
    conversationId: string,
    title: string,
    workDir?: string,
    spaceLabel?: string,
    openCanvas: boolean = true
  ): Promise<string> {
    const previousIsOpen = this.isOpen
    await this.switchSpaceSession(spaceId)
    const session = this.getOrCreateSession(spaceId)

    // Check if this conversation is already open in this space
    const existing = session.tabs.find(
      (tab) => tab.type === 'chat' && tab.conversationId === conversationId
    )

    if (existing) {
      if (existing.workDir !== workDir || existing.title !== title || existing.spaceLabel !== spaceLabel) {
        existing.spaceId = spaceId
        existing.title = title
        existing.workDir = workDir
        existing.spaceLabel = spaceLabel
        this.notifyTabsChange()
      }
      await this.switchTab(existing.id)
      if (!openCanvas) {
        this.setOpen(previousIsOpen)
      }
      return existing.id
    }

    this.enforceMaxTabs(session)

    // Create new chat tab
    const tabId = generateTabId()
    const tab: TabState = {
      id: tabId,
      type: 'chat',
      title,
      spaceLabel,
      conversationId,
      spaceId,
      workDir,
      isDirty: false,
      isLoading: false,
      lastActiveAt: Date.now(),
    }

    session.tabs.push(tab)
    session.activeTabId = tabId
    this.activeTabId = tabId
    if (openCanvas) {
      this.setOpen(true)
    }
    this.notifyTabsChange()

    await this.switchTab(tabId)
    if (!openCanvas) {
      this.setOpen(previousIsOpen)
    }

    return tabId
  }

  /**
   * Open Template Library in a Canvas tab
   * Reuses existing template tab for the same workDir when possible
   */
  async openTemplateLibrary(
    title: string,
    initialTab: TemplateLibraryTab,
    workDir?: string
  ): Promise<string> {
    const session = this.ensureCurrentSession()

    const existing = session.tabs.find(
      (tab) => tab.type === 'template-library' && tab.workDir === workDir
    )

    if (existing) {
      existing.title = title
      existing.workDir = workDir
      existing.templateLibraryTab = initialTab
      this.setOpen(true)
      this.notifyTabsChange()
      await this.switchTab(existing.id)
      return existing.id
    }

    this.enforceMaxTabs(session)

    const tabId = generateTabId()
    const tab: TabState = {
      id: tabId,
      type: 'template-library',
      title,
      workDir,
      spaceId: session.spaceId,
      templateLibraryTab: initialTab,
      isDirty: false,
      isLoading: false,
    }

    session.tabs.push(tab)
    session.activeTabId = tabId
    this.activeTabId = tabId
    this.setOpen(true)
    this.notifyTabsChange()

    await this.switchTab(tabId)

    return tabId
  }

  /**
   * Close a tab
   */
  async closeTab(tabId: string): Promise<void> {
    const session = this.getCurrentSession()
    if (!session) {
      return
    }
    if (!session.tabs.some((tab) => tab.id === tabId)) {
      return
    }

    this.removeTabFromSession(session, tabId)
  }

  /**
   * Close all tabs
   */
  async closeAll(): Promise<void> {
    this.spaceSessions.clear()
    this.currentSpaceId = null
    this.activeTabId = null
    this.setOpen(false)

    this.notifyTabsChange()
    this.notifyActiveTabChange()
  }

  /**
   * Switch to a specific tab
   */
  async switchTab(tabId: string): Promise<void> {
    const session = this.getCurrentSession()
    if (!session) {
      return
    }

    const tab = session.tabs.find((item) => item.id === tabId)
    if (!tab) {
      return
    }

    tab.lastActiveAt = Date.now()
    session.activeTabId = tabId
    this.activeTabId = tabId

    // Notify React
    this.notifyActiveTabChange()
  }

  /**
   * Switch to next tab (cyclic)
   */
  async switchToNextTab(): Promise<void> {
    const tabs = this.getVisibleTabs()
    if (tabs.length === 0) return

    const tabIds = tabs.map((tab) => tab.id)
    const currentIndex = this.activeTabId ? tabIds.indexOf(this.activeTabId) : -1
    const nextIndex = (currentIndex + 1) % tabIds.length

    await this.switchTab(tabIds[nextIndex])
  }

  /**
   * Switch to previous tab (cyclic)
   */
  async switchToPrevTab(): Promise<void> {
    const tabs = this.getVisibleTabs()
    if (tabs.length === 0) return

    const tabIds = tabs.map((tab) => tab.id)
    const currentIndex = this.activeTabId ? tabIds.indexOf(this.activeTabId) : 0
    const prevIndex = currentIndex <= 0 ? tabIds.length - 1 : currentIndex - 1

    await this.switchTab(tabIds[prevIndex])
  }

  /**
   * Switch to tab by index (1-indexed for keyboard shortcuts)
   */
  async switchToTabIndex(index: number): Promise<void> {
    const tabIds = this.getVisibleTabs().map((tab) => tab.id)
    if (index > 0 && index <= tabIds.length) {
      await this.switchTab(tabIds[index - 1])
    }
  }

  /**
   * Reorder tabs (for drag and drop)
   */
  reorderTabs(fromIndex: number, toIndex: number): void {
    const session = this.getCurrentSession()
    if (!session) {
      return
    }

    const tabsArray = [...session.tabs]
    const [removed] = tabsArray.splice(fromIndex, 1)
    tabsArray.splice(toIndex, 0, removed)

    session.tabs = tabsArray
    this.notifyTabsChange()
  }

  // ============================================
  // Content Actions
  // ============================================

  /**
   * Refresh tab content
   */
  async refreshTab(tabId: string): Promise<void> {
    const session = this.getCurrentSession()
    if (!session) return
    const tab = session.tabs.find((item) => item.id === tabId)
    if (!tab) return

    if (tab.path) {
      // Reload file content
      tab.isLoading = true
      tab.error = undefined
      this.notifyTabsChange()

      await this.loadFileContent(tabId, tab.path, tab.type)
    }
  }

  /**
   * Update tab content (for editing)
   */
  updateTabContent(tabId: string, content: string): void {
    const tab = this.getCurrentSession()?.tabs.find((item) => item.id === tabId)
    if (tab) {
      tab.content = content
      tab.isDirty = true
      this.notifyTabsChange()
    }
  }

  /**
   * Save scroll position
   */
  saveScrollPosition(tabId: string, position: number): void {
    const tab = this.getCurrentSession()?.tabs.find((item) => item.id === tabId)
    if (tab) {
      tab.scrollPosition = position
      // No need to notify for scroll position updates
    }
  }

  /**
   * Save file content to disk
   */
  async saveFile(tabId: string): Promise<boolean> {
    const tab = this.getCurrentSession()?.tabs.find((item) => item.id === tabId)
    if (!tab || !tab.path || tab.content === undefined) {
      return false
    }

    try {
      const response = await api.writeArtifactContent(tab.path, tab.content)

      if (response.success) {
        tab.isDirty = false
        this.notifyTabsChange()
        return true
      }
      return false
    } catch {
      return false
    }
  }

  /**
   * Check if there are any unsaved changes across all tabs
   */
  hasUnsavedChanges(): boolean {
    for (const session of this.spaceSessions.values()) {
      for (const tab of session.tabs) {
        if (tab.isDirty) {
          return true
        }
      }
    }
    return false
  }

  // ============================================
  // Layout Actions
  // ============================================

  /**
   * Set canvas open state
   */
  setOpen(open: boolean): void {
    if (this.isOpen === open) return

    // Can't open if no visible tabs
    if (open && this.getVisibleTabs().length === 0) return

    this.isOpen = open
    this.isTransitioning = true

    this.notifyOpenStateChange()

    // Clear transitioning after animation
    setTimeout(() => {
      this.isTransitioning = false
    }, 300)
  }

  /**
   * Toggle canvas visibility
   */
  toggleOpen(): void {
    if (!this.isOpen && this.getVisibleTabs().length === 0) return
    this.setOpen(!this.isOpen)
  }

  // ============================================
  // State Queries
  // ============================================

  getTabs(): TabState[] {
    return this.getVisibleTabs()
  }

  getTab(tabId: string): TabState | undefined {
    return this.getCurrentSession()?.tabs.find((tab) => tab.id === tabId)
  }

  getActiveTabId(): string | null {
    return this.activeTabId
  }

  getActiveTab(): TabState | undefined {
    return this.activeTabId ? this.getCurrentSessionTab(this.activeTabId) : undefined
  }

  getIsOpen(): boolean {
    return this.isOpen
  }

  getIsTransitioning(): boolean {
    return this.isTransitioning
  }

  getTabCount(): number {
    return this.getVisibleTabs().length
  }

  getCurrentSpaceId(): string | null {
    return this.currentSpaceId
  }

  /**
   * Backward compatible alias of switchSpaceSession
   */
  async enterSpace(spaceId: string): Promise<boolean> {
    const previousSpaceId = this.currentSpaceId
    await this.switchSpaceSession(spaceId)
    return previousSpaceId !== null && previousSpaceId !== spaceId
  }

  // ============================================
  // Event Subscriptions
  // ============================================

  onTabsChange(callback: TabsChangeCallback): () => void {
    this.tabsChangeCallbacks.add(callback)
    // Immediately call with current state
    callback(this.getTabs())
    return () => this.tabsChangeCallbacks.delete(callback)
  }

  onActiveTabChange(callback: ActiveTabChangeCallback): () => void {
    this.activeTabChangeCallbacks.add(callback)
    // Immediately call with current state
    callback(this.activeTabId)
    return () => this.activeTabChangeCallbacks.delete(callback)
  }

  onOpenStateChange(callback: OpenStateChangeCallback): () => void {
    this.openStateChangeCallbacks.add(callback)
    // Immediately call with current state
    callback(this.isOpen)
    return () => this.openStateChangeCallbacks.delete(callback)
  }

  // ============================================
  // Notification Helpers
  // ============================================

  private notifyTabsChange(): void {
    const tabs = this.getTabs()
    this.tabsChangeCallbacks.forEach(cb => cb(tabs))
  }

  private notifyActiveTabChange(): void {
    this.activeTabChangeCallbacks.forEach(cb => cb(this.activeTabId))
  }

  private notifyOpenStateChange(): void {
    this.openStateChangeCallbacks.forEach(cb => cb(this.isOpen))
  }
}

// Singleton instance
export const canvasLifecycle = new CanvasLifecycle()

// Auto-initialize on module load
canvasLifecycle.initialize()

// Export types for external use
export type { TabsChangeCallback, ActiveTabChangeCallback, OpenStateChangeCallback }
