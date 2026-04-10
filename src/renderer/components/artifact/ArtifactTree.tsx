/**
 * ArtifactTree - Professional tree view using react-arborist
 * VSCode-style file explorer with keyboard navigation, virtual scrolling, and more
 */

import { useState, useCallback, useEffect, useMemo, createContext, useContext, useRef } from 'react'
import { Tree, NodeRendererProps, NodeApi } from 'react-arborist'
import { api } from '../../api'
import { useCanvasStore } from '../../stores/canvas.store'
import type { ArtifactTreeNode } from '../../types'
import { FileIcon } from '../icons/ToolIcons'
import {
  ChevronRight,
  ChevronDown,
  Download,
  Eye,
  FilePlus,
  FolderPlus,
  RefreshCw,
  Pencil,
  Copy,
  Trash2,
  FolderOpen
} from 'lucide-react'
import { useIsGenerating } from '../../stores/chat.store'
import { useTranslation } from '../../i18n'

// Context to pass openFile function to tree nodes without each node subscribing to store
// This prevents massive re-renders when canvas state changes
type OpenFileFn = (spaceId: string, path: string, title?: string) => Promise<void>
const OpenFileContext = createContext<OpenFileFn | null>(null)

// Context for tree operations (context menu, drag, etc.)
interface TreeOperationsContext {
  onContextMenu: (e: React.MouseEvent, node: TreeNodeData) => void
  spaceWorkingDir: string
  spaceId: string
  activeFilePath: string | null
}
const TreeOperationsContext = createContext<TreeOperationsContext | null>(null)

const isWebMode = api.isRemoteMode()

interface ArtifactTreeProps {
  spaceId: string
  activeFilePath?: string | null
}

// Fixed offsets for tree height calculation (in pixels)
// App Header (44) + Rail Header (40) + Rail Footer (~60) + buffer
const TREE_HEIGHT_OFFSET = 152

// Simple hook using window height minus fixed offset
// No complex measurement needed - window.innerHeight is always immediately available
function useTreeHeight() {
  const [height, setHeight] = useState(() => window.innerHeight - TREE_HEIGHT_OFFSET)

  useEffect(() => {
    const handleResize = () => {
      setHeight(window.innerHeight - TREE_HEIGHT_OFFSET)
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return height
}

// Transform backend tree data to react-arborist format
interface TreeNodeData {
  id: string
  name: string
  path: string
  parentPath: string
  extension: string
  isFolder: boolean
  children?: TreeNodeData[]
}

function transformToArboristData(nodes: ArtifactTreeNode[], parentPath: string): TreeNodeData[] {
  return nodes.map(node => ({
    id: node.id,
    name: node.name,
    path: node.path,
    parentPath,
    extension: node.extension,
    isFolder: node.type === 'folder',
    children: node.children ? transformToArboristData(node.children, node.path) : undefined
  }))
}

function inferParentPath(filePath: string): string {
  const normalizedPath = filePath.replace(/[\\/]+$/g, '')
  const separatorIndex = Math.max(
    normalizedPath.lastIndexOf('/'),
    normalizedPath.lastIndexOf('\\')
  )
  if (separatorIndex <= 0) return ''
  return normalizedPath.slice(0, separatorIndex)
}

function buildChildPath(parentPath: string, name: string): string {
  const trimmedParent = parentPath.replace(/[\\/]+$/, '')
  if (!trimmedParent) return name
  const separator = trimmedParent.includes('\\') && !trimmedParent.includes('/') ? '\\' : '/'
  return `${trimmedParent}${separator}${name}`
}

interface CreateDraftState {
  type: 'file' | 'folder'
  parentPath: string
  name: string
}

// Context menu state
interface ContextMenuState {
  x: number
  y: number
  node?: TreeNodeData
  createTargetDir: string
}

export function ArtifactTree({ spaceId, activeFilePath = null }: ArtifactTreeProps) {
  const { t } = useTranslation()
  const [treeData, setTreeData] = useState<TreeNodeData[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [spaceWorkingDir, setSpaceWorkingDir] = useState<string>('')
  const [createDraft, setCreateDraft] = useState<CreateDraftState | null>(null)
  const [isComposingNameInput, setIsComposingNameInput] = useState(false)
  const isGenerating = useIsGenerating()
  const treeHeight = useTreeHeight()
  const containerRef = useRef<HTMLDivElement>(null)
  const createInputRef = useRef<HTMLInputElement>(null)
  const latestSpaceIdRef = useRef(spaceId)
  const loadTreeRequestIdRef = useRef(0)

  useEffect(() => {
    latestSpaceIdRef.current = spaceId
  }, [spaceId])

  // Subscribe to openFile once at parent level, pass down via context
  // This prevents each TreeNodeComponent from subscribing to the store
  const openFile = useCanvasStore(state => state.openFile)

  // Load tree data
  const loadTree = useCallback(async () => {
    if (!spaceId) return
    const requestId = ++loadTreeRequestIdRef.current
    const requestedSpaceId = spaceId

    try {
      setIsLoading(true)
      let resolvedSpaceDir = ''
      const spaceResponse = await api.getSpace(spaceId)
      const isStaleAfterGetSpace = requestId !== loadTreeRequestIdRef.current || requestedSpaceId !== latestSpaceIdRef.current
      if (isStaleAfterGetSpace) return
      if (spaceResponse.success && spaceResponse.data) {
        resolvedSpaceDir = (spaceResponse.data as { path: string }).path
        setSpaceWorkingDir(resolvedSpaceDir)
      } else if (spaceId === 'kite-temp') {
        const kiteSpaceResponse = await api.getKiteSpace()
        const isStaleAfterGetKiteSpace = requestId !== loadTreeRequestIdRef.current || requestedSpaceId !== latestSpaceIdRef.current
        if (isStaleAfterGetKiteSpace) return
        if (kiteSpaceResponse.success && kiteSpaceResponse.data) {
          resolvedSpaceDir = (kiteSpaceResponse.data as { path: string }).path
          setSpaceWorkingDir(resolvedSpaceDir)
        }
      }

      const response = await api.listArtifactsTree(spaceId)
      const isStaleAfterListTree = requestId !== loadTreeRequestIdRef.current || requestedSpaceId !== latestSpaceIdRef.current
      if (isStaleAfterListTree) return
      if (response.success && response.data) {
        const sourceNodes = response.data as ArtifactTreeNode[]
        if (!resolvedSpaceDir && sourceNodes.length > 0) {
          resolvedSpaceDir = inferParentPath(sourceNodes[0].path)
          setSpaceWorkingDir(resolvedSpaceDir)
        }

        const transformed = transformToArboristData(
          sourceNodes,
          resolvedSpaceDir
        )
        setTreeData(transformed)
      }
    } catch (error) {
      const isStale = requestId !== loadTreeRequestIdRef.current || requestedSpaceId !== latestSpaceIdRef.current
      if (isStale) return
      console.error('[ArtifactTree] Failed to load tree:', error)
    } finally {
      const isStaleRequest = requestId !== loadTreeRequestIdRef.current
      if (isStaleRequest) return
      setIsLoading(false)
    }
  }, [spaceId])

  // Load on mount and when space changes
  useEffect(() => {
    loadTree()
  }, [loadTree])

  // Refresh when generation completes
  useEffect(() => {
    if (!isGenerating) {
      const timer = setTimeout(loadTree, 500)
      return () => clearTimeout(timer)
    }
  }, [isGenerating, loadTree])

  // Refresh when external actions modify artifacts (e.g., change set rollback)
  useEffect(() => {
    const handleRefresh = (event: Event) => {
      const detail = (event as CustomEvent<{ spaceId?: string }>).detail
      if (detail?.spaceId && detail.spaceId !== spaceId) return
      loadTree()
    }

    window.addEventListener('artifacts:refresh', handleRefresh)
    return () => window.removeEventListener('artifacts:refresh', handleRefresh)
  }, [spaceId, loadTree])

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenu) {
        setContextMenu(null)
      }
    }
    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [contextMenu])

  useEffect(() => {
    if (!createDraft) return
    const raf = window.requestAnimationFrame(() => {
      createInputRef.current?.focus()
      createInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(raf)
  }, [createDraft?.type, createDraft?.parentPath])

  // File operations
  const startCreateDraft = useCallback((type: 'file' | 'folder', parentPath?: string) => {
    const targetDir = parentPath || spaceWorkingDir
    if (!targetDir) {
      console.error('[ArtifactTree] No target directory')
      alert(t('Space working directory was not found.'))
      return
    }

    setCreateDraft({
      type,
      parentPath: targetDir,
      name: ''
    })
    setContextMenu(null)
  }, [spaceWorkingDir, t])

  const cancelCreateDraft = useCallback(() => {
    setIsComposingNameInput(false)
    setCreateDraft(null)
  }, [])

  const submitCreateDraft = useCallback(async () => {
    if (!createDraft) return
    const name = createDraft.name.trim()
    if (!name) return

    try {
      const result = await api.createArtifactEntry<{
        path?: string
        name?: string
        type?: 'file' | 'folder'
      }>({
        type: createDraft.type,
        parentPath: createDraft.parentPath,
        name
      })

      if (result.success) {
        setIsComposingNameInput(false)
        setCreateDraft(null)
        loadTree()
        if (createDraft.type === 'file' && openFile) {
          const createdPath = result.data?.path || buildChildPath(createDraft.parentPath, name)
          await openFile(spaceId, createdPath, name)
        }
        return
      }

      const fallbackError = createDraft.type === 'file'
        ? t('Failed to create file')
        : t('Failed to create folder')
      alert(result.error || fallbackError)
    } catch (error) {
      const fallbackError = createDraft.type === 'file'
        ? t('Failed to create file')
        : t('Failed to create folder')
      alert((error as Error).message || fallbackError)
    }
  }, [createDraft, loadTree, openFile, spaceId, t])

  const handleRename = useCallback(async (node: TreeNodeData) => {
    const newName = prompt(t('Enter new name:'), node.name)
    if (!newName || newName === node.name) return

    const result = await api.renameArtifact(node.path, newName)
    if (result.success) {
      loadTree()
    } else {
      alert(result.error || t('Failed to rename'))
    }
  }, [loadTree, t])

  const handleDelete = useCallback(async (node: TreeNodeData) => {
    const confirmed = confirm(
      node.isFolder
        ? t('Delete folder "{{name}}" and all its contents?', { name: node.name })
        : t('Delete file "{{name}}"?', { name: node.name })
    )
    if (!confirmed) return

    const result = await api.deleteArtifact(node.path)
    if (result.success) {
      loadTree()
    } else {
      alert(result.error || t('Failed to delete'))
    }
  }, [loadTree, t])

  const handleCopyPath = useCallback((node: TreeNodeData) => {
    navigator.clipboard.writeText(node.path)
  }, [])

  const handleShowInFolder = useCallback(async (node: TreeNodeData) => {
    if (!isWebMode) {
      await api.showArtifactInFolder(node.path)
    }
  }, [])

  // Context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent, node: TreeNodeData) => {
    e.preventDefault()
    e.stopPropagation()
    const createTargetDir = node.isFolder ? node.path : (node.parentPath || spaceWorkingDir)
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      node,
      createTargetDir
    })
  }, [spaceWorkingDir])

  const handleBackgroundContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!spaceWorkingDir) return
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      createTargetDir: spaceWorkingDir
    })
  }, [spaceWorkingDir])

  // Handle tree move (drag & drop within tree)
  const handleMove = useCallback(async (args: {
    dragIds: string[]
    parentId: string | null
    index: number
  }) => {
    // Find the dragged node and target parent
    const findNode = (nodes: TreeNodeData[], id: string): TreeNodeData | null => {
      for (const node of nodes) {
        if (node.id === id) return node
        if (node.children) {
          const found = findNode(node.children, id)
          if (found) return found
        }
      }
      return null
    }

    const draggedNode = findNode(treeData, args.dragIds[0])
    if (!draggedNode) return

    let targetDir: string
    if (args.parentId) {
      const parentNode = findNode(treeData, args.parentId)
      if (parentNode && parentNode.isFolder) {
        targetDir = parentNode.path
      } else {
        return // Can't drop on a file
      }
    } else {
      targetDir = spaceWorkingDir
    }

    const result = await api.moveArtifact(draggedNode.path, targetDir)
    if (result.success) {
      loadTree()
    } else {
      console.error('[ArtifactTree] Move failed:', result.error)
    }
  }, [treeData, spaceWorkingDir, loadTree])

  // Tree operations context value
  const treeOperations = useMemo(() => ({
    onContextMenu: handleContextMenu,
    spaceWorkingDir,
    spaceId,
    activeFilePath
  }), [activeFilePath, handleContextMenu, spaceId, spaceWorkingDir])

  const renderCreateDraftInput = () => {
    if (!createDraft) return null

    return (
      <div className="px-2 py-1">
        <div className="flex items-center gap-2 rounded border border-primary/40 bg-background px-2 py-1">
          {createDraft.type === 'folder' ? (
            <FolderPlus className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          ) : (
            <FilePlus className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          )}
          <input
            ref={createInputRef}
            value={createDraft.name}
            onChange={(e) => setCreateDraft(prev => (prev ? { ...prev, name: e.target.value } : prev))}
            onCompositionStart={() => setIsComposingNameInput(true)}
            onCompositionEnd={() => setIsComposingNameInput(false)}
            onKeyDown={(e) => {
              // IME composing enter should not trigger submit
              if (isComposingNameInput || (e.nativeEvent as KeyboardEvent).isComposing) {
                return
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                submitCreateDraft()
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                cancelCreateDraft()
              }
            }}
            className="flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70"
            placeholder={createDraft.type === 'folder' ? t('Enter folder name:') : t('Enter file name:')}
          />
          <button
            type="button"
            onClick={() => submitCreateDraft()}
            className="px-2 py-0.5 text-xs rounded border border-border/60 hover:bg-secondary/80 transition-colors disabled:opacity-40"
            disabled={!createDraft.name.trim()}
          >
            {t('Create')}
          </button>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-2">
        <div className="w-6 h-6 rounded-full border-2 border-primary/30 border-t-primary animate-spin mb-2" />
        <p className="text-xs text-muted-foreground">{t('Loading...')}</p>
      </div>
    )
  }

  if (treeData.length === 0) {
    return (
      <div className="flex flex-col h-full">
        {/* Toolbar */}
        <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5">
          <button
            onClick={() => startCreateDraft('file')}
            className="p-1 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
            title={t('New file')}
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => startCreateDraft('folder')}
            className="p-1 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
            title={t('New folder')}
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={loadTree}
            className="p-1 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
            title={t('Refresh')}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {renderCreateDraftInput()}

        <div
          className="flex flex-col items-center justify-center flex-1 text-center px-2"
          onContextMenu={handleBackgroundContextMenu}
        >
          <div className="w-10 h-10 rounded-lg border border-dashed border-muted-foreground/30 flex items-center justify-center mb-2">
            <ChevronRight className="w-5 h-5 text-muted-foreground/40" />
          </div>
          <p className="text-xs text-muted-foreground">{t('No files')}</p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => startCreateDraft('file')}
              className="px-2 py-1 text-xs rounded border border-border/60 hover:bg-secondary/80 transition-colors"
            >
              {t('New file')}
            </button>
            <button
              onClick={() => startCreateDraft('folder')}
              className="px-2 py-1 text-xs rounded border border-border/60 hover:bg-secondary/80 transition-colors"
            >
              {t('New folder')}
            </button>
          </div>
        </div>

        {/* Context Menu */}
        {contextMenu && (
          <div
            className="fixed z-50 min-w-[160px] bg-popover border border-border rounded-md shadow-lg py-1"
            style={{
              left: contextMenu.x,
              top: contextMenu.y
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/80 flex items-center gap-2"
              onClick={() => {
                startCreateDraft('file', contextMenu.createTargetDir)
              }}
            >
              <FilePlus className="w-4 h-4" />
              {t('New file')}
            </button>
            <button
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/80 flex items-center gap-2"
              onClick={() => {
                startCreateDraft('folder', contextMenu.createTargetDir)
              }}
            >
              <FolderPlus className="w-4 h-4" />
              {t('New folder')}
            </button>
            <div className="h-px bg-border my-1" />
            <button
              className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/80 flex items-center gap-2"
              onClick={() => {
                loadTree()
                setContextMenu(null)
              }}
            >
              <RefreshCw className="w-4 h-4" />
              {t('Refresh')}
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <OpenFileContext.Provider value={openFile}>
      <TreeOperationsContext.Provider value={treeOperations}>
        <div ref={containerRef} className="flex flex-col h-full relative">
          {/* Toolbar */}
          <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5">
            <button
              onClick={() => startCreateDraft('file')}
              className="p-1 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
              title={t('New file')}
            >
              <FilePlus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => startCreateDraft('folder')}
              className="p-1 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
              title={t('New folder')}
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={loadTree}
              className="p-1 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
              title={t('Refresh')}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {renderCreateDraftInput()}

          {/* Tree - uses window height based calculation */}
          <div className="flex-1 overflow-hidden" onContextMenu={handleBackgroundContextMenu}>
            <Tree
              data={treeData}
              openByDefault={false}
              width="100%"
              height={treeHeight}
              indent={16}
              rowHeight={26}
              overscanCount={5}
              paddingTop={4}
              paddingBottom={4}
              disableDrag={false}
              disableDrop={false}
              disableEdit
              onMove={handleMove}
            >
              {TreeNodeComponent}
            </Tree>
          </div>

          {/* Context Menu */}
          {contextMenu && (
            <div
              className="fixed z-50 min-w-[160px] bg-popover border border-border rounded-md shadow-lg py-1"
              style={{
                left: contextMenu.x,
                top: contextMenu.y
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <>
                <button
                  className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/80 flex items-center gap-2"
                  onClick={() => {
                    startCreateDraft('file', contextMenu.createTargetDir)
                  }}
                >
                  <FilePlus className="w-4 h-4" />
                  {t('New file')}
                </button>
                <button
                  className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/80 flex items-center gap-2"
                  onClick={() => {
                    startCreateDraft('folder', contextMenu.createTargetDir)
                  }}
                >
                  <FolderPlus className="w-4 h-4" />
                  {t('New folder')}
                </button>
                {contextMenu.node && <div className="h-px bg-border my-1" />}
              </>
              {contextMenu.node && (
                <>
                  <button
                    className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/80 flex items-center gap-2"
                    onClick={() => {
                      handleRename(contextMenu.node!)
                      setContextMenu(null)
                    }}
                  >
                    <Pencil className="w-4 h-4" />
                    {t('Rename')}
                  </button>
                  <button
                    className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/80 flex items-center gap-2"
                    onClick={() => {
                      handleCopyPath(contextMenu.node!)
                      setContextMenu(null)
                    }}
                  >
                    <Copy className="w-4 h-4" />
                    {t('Copy path')}
                  </button>
                  {!isWebMode && (
                    <button
                      className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/80 flex items-center gap-2"
                      onClick={() => {
                        handleShowInFolder(contextMenu.node!)
                        setContextMenu(null)
                      }}
                    >
                      <FolderOpen className="w-4 h-4" />
                      {t('Open in folder')}
                    </button>
                  )}
                  <div className="h-px bg-border my-1" />
                  <button
                    className="w-full px-3 py-1.5 text-sm text-left hover:bg-secondary/80 flex items-center gap-2 text-destructive"
                    onClick={() => {
                      handleDelete(contextMenu.node!)
                      setContextMenu(null)
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                    {t('Delete')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </TreeOperationsContext.Provider>
    </OpenFileContext.Provider>
  )
}

// Custom node renderer for VSCode-like appearance
// Uses context for openFile to avoid store subscription in each node
function TreeNodeComponent({ node, style, dragHandle }: NodeRendererProps<TreeNodeData>) {
  const { t } = useTranslation()
  const [isHovered, setIsHovered] = useState(false)
  // Get openFile from context (subscribed once at parent ArtifactTree level)
  const openFile = useContext(OpenFileContext)
  const treeOps = useContext(TreeOperationsContext)
  const data = node.data
  const isFolder = data.isFolder

  // Desktop: open all files in canvas first (unknown suffix falls back to text viewer)
  const canViewInCanvas = !isFolder && !isWebMode

  // Handle click - open in canvas, system app, or download
  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isFolder) {
      node.toggle()
      return
    }

    // Try to open in Canvas first for viewable files
    if (canViewInCanvas && openFile) {
      openFile(treeOps!.spaceId, data.path, data.name)
      return
    }

    // Fallback behavior for non-viewable files
    if (isWebMode) {
      // In web mode, trigger download
      api.downloadArtifact(data.path)
    } else {
      // In desktop mode, open with system app
      try {
        await api.openArtifact(data.path)
      } catch (error) {
        console.error('Failed to open file:', error)
      }
    }
  }

  // Keep double-click behavior aligned with single-click: open in app tab
  const handleDoubleClickFile = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isFolder) {
      node.toggle()
      return
    }

    await handleClick(e)
  }

  // Handle right-click - show context menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (treeOps) {
      treeOps.onContextMenu(e, data)
    }
  }

  // Handle drag start for external drag (to canvas, etc.)
  const handleDragStart = (e: React.DragEvent) => {
    if (isFolder) return

    // Set data for external drop targets (like Content Canvas)
    e.dataTransfer.setData('application/x-kite-file', JSON.stringify({
      path: data.path,
      name: data.name,
      extension: data.extension
    }))
    e.dataTransfer.effectAllowed = 'copyMove'
  }

  const isActiveFile = !isFolder && treeOps?.activeFilePath === data.path

  return (
    <div
      ref={dragHandle}
      style={style}
      onClick={handleClick}
      onDoubleClick={handleDoubleClickFile}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      draggable={!isFolder}
      className={`
        flex items-center h-full pr-2 cursor-pointer select-none
        transition-colors duration-75
        ${isActiveFile ? 'bg-primary/20 ring-1 ring-primary/40' : ''}
        ${node.isSelected && !isActiveFile ? 'bg-primary/15' : ''}
        ${isHovered && !node.isSelected ? 'bg-secondary/60' : ''}
        ${node.isFocused ? 'outline outline-1 outline-primary/50 -outline-offset-1' : ''}
      `}
      title={canViewInCanvas
        ? t('Click to preview · double-click to open with system')
        : (isWebMode && !isFolder ? t('Click to download file') : data.path)
      }
    >
      {/* Expand/collapse arrow for folders */}
      <span
        className="w-4 h-4 flex items-center justify-center flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation()
          if (isFolder) node.toggle()
        }}
      >
        {isFolder ? (
          node.isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/70" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/70" />
          )
        ) : null}
      </span>

      {/* File/folder icon */}
      <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 mr-1.5">
        <FileIcon
          extension={data.extension}
          isFolder={isFolder}
          isOpen={isFolder && node.isOpen}
          colored={false}
          className="text-muted-foreground/75"
          size={15}
        />
      </span>

      {/* File name */}
      <span className={`
        text-[13px] truncate flex-1
        ${isFolder ? 'font-medium text-foreground/90' : 'text-foreground/80'}
      `}>
        {data.name}
      </span>

      {/* Action indicator */}
      {!isFolder && isHovered && (
        canViewInCanvas ? (
          <Eye className="w-3 h-3 text-primary flex-shrink-0 ml-1" />
        ) : isWebMode ? (
          <Download className="w-3 h-3 text-primary flex-shrink-0 ml-1" />
        ) : null
      )}
    </div>
  )
}
