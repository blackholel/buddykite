/**
 * Canvas Store - Thin Proxy Layer for Canvas Lifecycle
 *
 * This store acts as a bridge between the existing codebase (that uses
 * useCanvasStore) and the new CanvasLifecycle manager. It delegates all
 * operations to canvasLifecycle while maintaining API compatibility.
 *
 * IMPORTANT: This is a transitional layer. New code should use
 * useCanvasLifecycle hook directly. This store is kept for backward
 * compatibility with existing components.
 *
 * The actual state management is done by CanvasLifecycle singleton.
 * This store subscribes to canvasLifecycle changes and syncs state.
 */

import { create } from 'zustand'
import {
  canvasLifecycle,
  type TabState,
  type ContentType,
} from '../services/canvas-lifecycle'
import type { TemplateLibraryTab } from '../types/template-library'

// Re-export types for backward compatibility
export type { ContentType }
export type CanvasTab = TabState

// ============================================
// Store Interface (Backward Compatible)
// ============================================

interface CanvasState {
  // State (synced from canvasLifecycle)
  isOpen: boolean
  tabs: TabState[]
  activeTabId: string | null
  isTransitioning: boolean

  // Maximized mode state (Canvas takes full screen, hide Header/Chat/Rail)
  isMaximized: boolean

  // Computed
  getActiveTab: () => TabState | null
  getTabCount: () => number

  // Tab Actions (delegate to canvasLifecycle)
  openFile: (spaceId: string, path: string, title?: string) => Promise<void>
  openUrl: (url: string, title?: string) => Promise<void>
  openContent: (content: string, title: string, type: ContentType, language?: string) => void
  openPlan: (content: string, title: string, spaceId: string, conversationId: string, workDir?: string) => Promise<string>
  openChat: (spaceId: string, conversationId: string, title: string, workDir?: string) => Promise<void>
  openTemplateLibrary: (title: string, initialTab: TemplateLibraryTab, workDir?: string) => Promise<string>
  closeTab: (tabId: string) => void
  closeAllTabs: () => void
  switchTab: (tabId: string) => void
  switchToNextTab: () => void
  switchToPrevTab: () => void
  switchToTabIndex: (index: number) => void
  reorderTabs: (fromIndex: number, toIndex: number) => void

  // Content Actions
  refreshTab: (tabId: string) => Promise<void>
  updateTabContent: (tabId: string, content: string) => void
  saveScrollPosition: (tabId: string, position: number) => void

  // Layout Actions
  setOpen: (open: boolean) => void
  toggleOpen: () => void

  // Maximized Mode Actions
  setMaximized: (maximized: boolean) => void
  toggleMaximized: () => void

  // Internal
  setTransitioning: (transitioning: boolean) => void
}

// ============================================
// Store Implementation
// ============================================

export const useCanvasStore = create<CanvasState>((set, get) => {
  // Subscribe to canvasLifecycle state changes synchronously
  // canvasLifecycle is auto-initialized on module load, ensuring IPC listeners
  // are ready before any React components mount
  canvasLifecycle.onTabsChange((tabs) => {
    set({ tabs })
  })

  canvasLifecycle.onActiveTabChange((activeTabId) => {
    set({ activeTabId })
  })

  canvasLifecycle.onOpenStateChange((isOpen) => {
    set({ isOpen })
  })

  canvasLifecycle.onTransitioningStateChange((isTransitioning) => {
    set({ isTransitioning })
  })

  return {
    // Initial state - synchronized from canvasLifecycle singleton
    isOpen: canvasLifecycle.getIsOpen(),
    tabs: canvasLifecycle.getTabs(),
    activeTabId: canvasLifecycle.getActiveTabId(),
    isTransitioning: canvasLifecycle.getIsTransitioning(),

    // Maximized mode - local state (not in canvasLifecycle)
    isMaximized: false,

    // Computed: Get active tab
    getActiveTab: () => {
      const { tabs, activeTabId } = get()
      if (!activeTabId) return null
      return tabs.find(tab => tab.id === activeTabId) || null
    },

    // Computed: Get tab count
    getTabCount: () => get().tabs.length,

    // ============================================
    // Tab Actions (delegate to canvasLifecycle)
    // ============================================

    openFile: async (spaceId: string, path: string, title?: string) => {
      await canvasLifecycle.openFile(spaceId, path, title)
    },

    openUrl: async (url: string, title?: string) => {
      await canvasLifecycle.openUrl(url, title)
    },

    openContent: (content: string, title: string, type: ContentType, language?: string) => {
      canvasLifecycle.openContent(content, title, type, language)
    },

    openPlan: async (content: string, title: string, spaceId: string, conversationId: string, workDir?: string) => {
      return await canvasLifecycle.openPlan(content, title, spaceId, conversationId, workDir)
    },

    openChat: async (spaceId: string, conversationId: string, title: string, workDir?: string) => {
      await canvasLifecycle.openChat(spaceId, conversationId, title, workDir)
    },

    openTemplateLibrary: async (title: string, initialTab: TemplateLibraryTab, workDir?: string) => {
      return await canvasLifecycle.openTemplateLibrary(title, initialTab, workDir)
    },

    closeTab: (tabId: string) => {
      canvasLifecycle.closeTab(tabId)
    },

    closeAllTabs: () => {
      canvasLifecycle.closeAll()
    },

    switchTab: (tabId: string) => {
      canvasLifecycle.switchTab(tabId)
    },

    switchToNextTab: () => {
      canvasLifecycle.switchToNextTab()
    },

    switchToPrevTab: () => {
      canvasLifecycle.switchToPrevTab()
    },

    switchToTabIndex: (index: number) => {
      canvasLifecycle.switchToTabIndex(index)
    },

    reorderTabs: (fromIndex: number, toIndex: number) => {
      canvasLifecycle.reorderTabs(fromIndex, toIndex)
    },

    // ============================================
    // Content Actions
    // ============================================

    refreshTab: async (tabId: string) => {
      await canvasLifecycle.refreshTab(tabId)
    },

    updateTabContent: (tabId: string, content: string) => {
      canvasLifecycle.updateTabContent(tabId, content)
    },

    saveScrollPosition: (tabId: string, position: number) => {
      canvasLifecycle.saveScrollPosition(tabId, position)
    },

    // ============================================
    // Layout Actions
    // ============================================

    setOpen: (open: boolean) => {
      canvasLifecycle.setOpen(open)
    },

    toggleOpen: () => {
      canvasLifecycle.toggleOpen()
    },

    // ============================================
    // Maximized Mode Actions
    // ============================================

    setMaximized: (maximized: boolean) => {
      // When maximizing, ensure canvas is open
      if (maximized && !get().isOpen) {
        canvasLifecycle.setOpen(true)
      }
      // When exiting maximized, keep canvas open
      set({ isMaximized: maximized })
    },

    toggleMaximized: () => {
      const { isMaximized, isOpen } = get()
      if (!isMaximized && !isOpen) {
        canvasLifecycle.setOpen(true)
      }
      set({ isMaximized: !isMaximized })
    },

    setTransitioning: (transitioning: boolean) => {
      set({ isTransitioning: transitioning })
    },
  }
})

// ============================================
// Selectors (Backward Compatible)
// ============================================

/**
 * Selector: Is canvas open?
 */
export function useCanvasIsOpen(): boolean {
  return useCanvasStore(state => state.isOpen)
}

/**
 * Selector: Get active tab
 */
export function useActiveTab(): TabState | null {
  return useCanvasStore(state => {
    if (!state.activeTabId) return null
    return state.tabs.find(tab => tab.id === state.activeTabId) || null
  })
}

/**
 * Selector: Get tab count
 */
export function useTabCount(): number {
  return useCanvasStore(state => state.tabs.length)
}

/**
 * Selector: Is transitioning?
 */
export function useIsTransitioning(): boolean {
  return useCanvasStore(state => state.isTransitioning)
}

/**
 * Selector: Is canvas maximized?
 */
export function useCanvasIsMaximized(): boolean {
  return useCanvasStore(state => state.isMaximized)
}
