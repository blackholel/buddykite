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
  path?: string
  url?: string
  content?: string
  language?: string
  mimeType?: string
  isDirty: boolean
  isLoading: boolean
  error?: string
  scrollPosition?: number
  // Session-bound tab fields (used by chat tabs and plan tabs)
  conversationId?: string
  spaceId?: string
  workDir?: string
  templateLibraryTab?: TemplateLibraryTab
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

// ============================================
// CanvasLifecycle Class
// ============================================

class CanvasLifecycle {
  // Core state
  private tabs: Map<string, TabState> = new Map()
  private activeTabId: string | null = null
  private isOpen: boolean = false
  private isTransitioning: boolean = false

  // Track which space the current tabs belong to
  private currentSpaceId: string | null = null
  private enterSpaceSequence: number = 0

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

  // ============================================
  // Tab Management
  // ============================================

  /**
   * Open a file in the canvas
   */
  async openFile(path: string, title?: string): Promise<string> {
    // Check if file is already open
    for (const [tabId, tab] of this.tabs) {
      if (tab.path === path) {
        await this.switchTab(tabId)
        return tabId
      }
    }

    // Detect content type
    const { type, language } = detectContentType(path)

    // PDF files are opened in system default app
    if (type === 'pdf') {
      return this.openPdf(path, title)
    }

    // Create new tab
    const tabId = generateTabId()
    const tab: TabState = {
      id: tabId,
      type,
      title: title || getFileName(path),
      path,
      language,
      isDirty: false,
      isLoading: true,
    }

    this.tabs.set(tabId, tab)
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
    const tab = this.tabs.get(tabId)
    if (!tab) return

    // Images use kite-file:// protocol directly (no content loading needed)
    if (type === 'image') {
      tab.isLoading = false
      this.notifyTabsChange()
      return
    }

    try {
      const response = await api.readArtifactContent(path)

      // Tab might have been closed during async operation
      if (!this.tabs.has(tabId)) return

      if (response.success && response.data) {
        const data = response.data as { content: string; mimeType?: string }
        tab.content = data.content
        tab.mimeType = data.mimeType
        tab.isLoading = false
        tab.error = undefined
      } else {
        throw new Error(response.error || 'Failed to read file')
      }
    } catch (error) {
      const currentTab = this.tabs.get(tabId)
      if (currentTab) {
        currentTab.isLoading = false
        currentTab.error = (error as Error).message
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
    const tabId = generateTabId()
    const tab: TabState = {
      id: tabId,
      type,
      title,
      content,
      language,
      isDirty: false,
      isLoading: false,
    }

    this.tabs.set(tabId, tab)
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
    // Find existing plan tab for this conversation in this space
    for (const [tabId, tab] of this.tabs) {
      if (tab.type === 'plan' && tab.spaceId === spaceId && tab.conversationId === conversationId) {
        this.setOpen(true)

        // If user has local edits, keep local content
        if (tab.isDirty) {
          await this.switchTab(tabId)
          return tabId
        }

        // Immutable update: create new tab object instead of mutating in-place
        this.tabs.set(tabId, {
          ...tab,
          content,
          title,
          language: 'markdown',
          workDir: workDir ?? tab.workDir,
          isDirty: false,
          error: undefined,
        })
        this.notifyTabsChange()
        await this.switchTab(tabId)
        return tabId
      }
    }

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

    this.tabs.set(tabId, tab)
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
    workDir?: string
  ): Promise<string> {
    // Check if this conversation is already open
    for (const [tabId, tab] of this.tabs) {
      if (tab.type === 'chat' && tab.conversationId === conversationId) {
        if (tab.spaceId !== spaceId || (workDir && tab.workDir !== workDir)) {
          this.tabs.set(tabId, {
            ...tab,
            spaceId,
            workDir: workDir ?? tab.workDir
          })
          this.notifyTabsChange()
        }
        await this.switchTab(tabId)
        return tabId
      }
    }

    // Create new chat tab
    const tabId = generateTabId()
    const tab: TabState = {
      id: tabId,
      type: 'chat',
      title,
      conversationId,
      spaceId,
      workDir,
      isDirty: false,
      isLoading: false,
    }

    this.tabs.set(tabId, tab)
    this.setOpen(true)
    this.notifyTabsChange()

    await this.switchTab(tabId)

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
    for (const [tabId, tab] of this.tabs) {
      if (tab.type === 'template-library' && tab.workDir === workDir) {
        this.tabs.set(tabId, {
          ...tab,
          title,
          workDir,
          templateLibraryTab: initialTab
        })
        this.setOpen(true)
        this.notifyTabsChange()
        await this.switchTab(tabId)
        return tabId
      }
    }

    const tabId = generateTabId()
    const tab: TabState = {
      id: tabId,
      type: 'template-library',
      title,
      workDir,
      templateLibraryTab: initialTab,
      isDirty: false,
      isLoading: false
    }

    this.tabs.set(tabId, tab)
    this.setOpen(true)
    this.notifyTabsChange()

    await this.switchTab(tabId)

    return tabId
  }

  /**
   * Close a tab
   */
  async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    // Remove tab
    this.tabs.delete(tabId)

    // If closing active tab, switch to another tab
    if (this.activeTabId === tabId) {
      const remainingTabs = Array.from(this.tabs.keys())
      if (remainingTabs.length > 0) {
        await this.switchTab(remainingTabs[remainingTabs.length - 1])
      } else {
        this.activeTabId = null
        this.setOpen(false)
        this.notifyActiveTabChange()
      }
    }

    this.notifyTabsChange()
  }

  /**
   * Close all tabs
   */
  async closeAll(): Promise<void> {
    this.tabs.clear()
    this.activeTabId = null
    this.setOpen(false)

    this.notifyTabsChange()
    this.notifyActiveTabChange()
  }

  /**
   * Switch to a specific tab
   */
  async switchTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) {
      return
    }

    this.activeTabId = tabId

    // Notify React
    this.notifyActiveTabChange()
  }

  /**
   * Switch to next tab (cyclic)
   */
  async switchToNextTab(): Promise<void> {
    if (this.tabs.size === 0) return

    const tabIds = Array.from(this.tabs.keys())
    const currentIndex = this.activeTabId ? tabIds.indexOf(this.activeTabId) : -1
    const nextIndex = (currentIndex + 1) % tabIds.length

    await this.switchTab(tabIds[nextIndex])
  }

  /**
   * Switch to previous tab (cyclic)
   */
  async switchToPrevTab(): Promise<void> {
    if (this.tabs.size === 0) return

    const tabIds = Array.from(this.tabs.keys())
    const currentIndex = this.activeTabId ? tabIds.indexOf(this.activeTabId) : 0
    const prevIndex = currentIndex <= 0 ? tabIds.length - 1 : currentIndex - 1

    await this.switchTab(tabIds[prevIndex])
  }

  /**
   * Switch to tab by index (1-indexed for keyboard shortcuts)
   */
  async switchToTabIndex(index: number): Promise<void> {
    const tabIds = Array.from(this.tabs.keys())
    if (index > 0 && index <= tabIds.length) {
      await this.switchTab(tabIds[index - 1])
    }
  }

  /**
   * Reorder tabs (for drag and drop)
   */
  reorderTabs(fromIndex: number, toIndex: number): void {
    const tabsArray = Array.from(this.tabs.entries())
    const [removed] = tabsArray.splice(fromIndex, 1)
    tabsArray.splice(toIndex, 0, removed)

    this.tabs = new Map(tabsArray)
    this.notifyTabsChange()
  }

  // ============================================
  // Content Actions
  // ============================================

  /**
   * Refresh tab content
   */
  async refreshTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
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
    const tab = this.tabs.get(tabId)
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
    const tab = this.tabs.get(tabId)
    if (tab) {
      tab.scrollPosition = position
      // No need to notify for scroll position updates
    }
  }

  /**
   * Save file content to disk
   */
  async saveFile(tabId: string): Promise<boolean> {
    const tab = this.tabs.get(tabId)
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
    for (const [, tab] of this.tabs) {
      if (tab.isDirty) {
        return true
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

    // Can't open if no tabs
    if (open && this.tabs.size === 0) return

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
    if (!this.isOpen && this.tabs.size === 0) return
    this.setOpen(!this.isOpen)
  }

  // ============================================
  // State Queries
  // ============================================

  getTabs(): TabState[] {
    return Array.from(this.tabs.values())
  }

  getTab(tabId: string): TabState | undefined {
    return this.tabs.get(tabId)
  }

  getActiveTabId(): string | null {
    return this.activeTabId
  }

  getActiveTab(): TabState | undefined {
    return this.activeTabId ? this.tabs.get(this.activeTabId) : undefined
  }

  getIsOpen(): boolean {
    return this.isOpen
  }

  getIsTransitioning(): boolean {
    return this.isTransitioning
  }

  getTabCount(): number {
    return this.tabs.size
  }

  getCurrentSpaceId(): string | null {
    return this.currentSpaceId
  }

  /**
   * Called when entering a space - clears tabs if switching to different space
   * This is the single point of control for Space isolation of Canvas state.
   * Returns true if tabs were cleared
   */
  async enterSpace(spaceId: string): Promise<boolean> {
    const sequence = ++this.enterSpaceSequence
    const previousSpaceId = this.currentSpaceId

    const hasTabs = this.tabs.size > 0
    const hasForeignSpaceBoundTabs = hasTabs && Array.from(this.tabs.values()).some(
      (tab) => Boolean(tab.spaceId) && tab.spaceId !== spaceId
    )
    const shouldClearTabs =
      hasTabs &&
      (
        // Normal space switch: clear all tabs.
        (previousSpaceId !== null && previousSpaceId !== spaceId) ||
        // Recovery path: lifecycle lost currentSpaceId but stale tabs still exist.
        previousSpaceId === null ||
        // Safety net: tab metadata already proves these tabs belong to other space.
        hasForeignSpaceBoundTabs
      )

    if (shouldClearTabs) {
      // Switching to different space with existing tabs - clear all
      await this.closeAll()
      if (sequence !== this.enterSpaceSequence) {
        return false
      }
      this.currentSpaceId = spaceId
      return true
    }

    if (sequence !== this.enterSpaceSequence) {
      return false
    }
    this.currentSpaceId = spaceId
    return false
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
