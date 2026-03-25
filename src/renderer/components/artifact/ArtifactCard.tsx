/**
 * Artifact Card - Single file/folder display with enhanced interactivity
 * Supports both desktop (open) and web (download) modes
 * Integrates with Content Canvas for in-app file viewing
 */

import { useState } from 'react'
import { api } from '../../api'
import { useCanvasStore } from '../../stores/canvas.store'
import type { Artifact } from '../../types'
import { FileIcon } from '../icons/ToolIcons'
import { ExternalLink, Download, Eye } from 'lucide-react'
import { useTranslation } from '../../i18n'

// Check if running in web mode
const isWebMode = api.isRemoteMode()

interface ArtifactCardProps {
  artifact: Artifact
  spaceId: string
  isActive?: boolean
}

// Format file size
function formatSize(bytes?: number): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ArtifactCard({ artifact, spaceId, isActive = false }: ArtifactCardProps) {
  const { t } = useTranslation()
  const [isHovered, setIsHovered] = useState(false)
  const openFile = useCanvasStore(state => state.openFile)
  const openContent = useCanvasStore(state => state.openContent)
  const isFolder = artifact.type === 'folder'

  // Desktop: open all files in canvas first (unknown suffix falls back to text viewer)
  const canViewInCanvas = !isFolder && !isWebMode

  // Handle click
  // Folder (desktop): open folder index in Canvas tab
  // File: Canvas > System App (desktop) > Download (web)
  const handleClick = async () => {
    if (isFolder) {
      if (isWebMode) return

      const normalizedFolderPath = artifact.path.replace(/\\/g, '/').replace(/\/+$/g, '')
      const folderPrefix = `${normalizedFolderPath}/`

      try {
        const response = await api.listArtifacts(spaceId)
        if (!response.success || !response.data) {
          throw new Error(response.error || 'Failed to list folder entries')
        }

        const entries = (response.data as Artifact[])
          .filter((entry) => {
            const normalizedEntryPath = entry.path.replace(/\\/g, '/')
            return normalizedEntryPath !== normalizedFolderPath && normalizedEntryPath.startsWith(folderPrefix)
          })
          .sort((a, b) => a.path.localeCompare(b.path))

        const entryLines = entries.map((entry) => {
          const normalizedEntryPath = entry.path.replace(/\\/g, '/')
          const relativePath = normalizedEntryPath.slice(folderPrefix.length)
          return `${entry.type === 'folder' ? '[DIR]' : '[FILE]'} ${relativePath}`
        })

        const content = [
          `# ${artifact.name}`,
          '',
          `${t('Path')}: ${artifact.path}`,
          `${t('Items')}: ${entries.length}`,
          '',
          ...(entryLines.length > 0 ? entryLines : [t('No files')])
        ].join('\n')

        openContent(content, `${artifact.name}/`, 'text')
      } catch (error) {
        const fallbackContent = [
          `# ${artifact.name}`,
          '',
          `${t('Path')}: ${artifact.path}`,
          '',
          (error as Error).message || t('Failed to load details')
        ].join('\n')
        openContent(fallbackContent, `${artifact.name}/`, 'text')
      }
      return
    }

    // Try to open in Canvas first for viewable files
    if (canViewInCanvas) {
      openFile(spaceId, artifact.path, artifact.name)
      return
    }

    // Fallback behavior for non-viewable files
    if (isWebMode) {
      // In web mode, trigger download
      api.downloadArtifact(artifact.path)
    } else {
      // In desktop mode, open with system app
      try {
        const response = await api.openArtifact(artifact.path)
        if (!response.success) {
          console.error('Failed to open artifact:', response.error)
        }
      } catch (error) {
        console.error('Failed to open artifact:', error)
      }
    }
  }

  // Keep double-click behavior aligned with single-click: open in app tab
  const handleDoubleClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await handleClick()
  }

  // Handle right-click to show in folder (desktop only)
  const handleContextMenu = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (isWebMode) return
    try {
      await api.showArtifactInFolder(artifact.path)
    } catch (error) {
      console.error('Failed to show in folder:', error)
    }
  }

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      data-active={isActive ? 'true' : 'false'}
      className={`
        w-full artifact-card p-2.5 rounded-lg text-left
        transition-all duration-200 group cursor-pointer
        ${isActive ? 'ring-1 ring-primary/50 bg-primary/5' : ''}
        ${isHovered
          ? 'bg-secondary shadow-sm'
          : 'bg-secondary/50 hover:bg-secondary/80'
        }
      `}
      title={canViewInCanvas
        ? t('Click to preview · double-click to open with system')
        : (isWebMode ? t('Click to download file') : artifact.path)
      }
    >
      <div className="flex items-center gap-2.5">
        {/* Icon */}
        <div className={`transition-transform duration-200 ${isHovered ? 'scale-110' : ''}`}>
          <FileIcon extension={artifact.extension} isFolder={isFolder} size={18} />
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate text-foreground/90">
            {artifact.name}
          </p>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {!isFolder && artifact.extension && (
              <span className="uppercase">{artifact.extension}</span>
            )}
            {!isFolder && artifact.size !== undefined && artifact.extension && (
              <span className="text-muted-foreground/50">·</span>
            )}
            {!isFolder && artifact.size !== undefined && (
              <span>{formatSize(artifact.size)}</span>
            )}
            {isFolder && (
              <span>{t('Folder')}</span>
            )}
          </div>
        </div>

        {/* Hover action indicator */}
        {isHovered && (
          canViewInCanvas ? (
            <Eye className="w-4 h-4 text-primary flex-shrink-0" />
          ) : isWebMode ? (
            <Download className="w-4 h-4 text-primary flex-shrink-0" />
          ) : (
            <ExternalLink className="w-4 h-4 text-muted-foreground/50 flex-shrink-0" />
          )
        )}
      </div>

      {/* Preview (for text files) */}
      {artifact.preview && isHovered && (
        <div className="mt-2 p-2 bg-background/50 rounded text-xs text-muted-foreground font-mono overflow-hidden max-h-16">
          <pre className="truncate">{artifact.preview.substring(0, 100)}</pre>
        </div>
      )}
    </div>
  )
}
