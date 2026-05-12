import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  FilePlus,
  FileText,
  FileX,
  History,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Undo2,
} from 'lucide-react'
import { api } from '../../../api'
import { useCanvasLifecycle } from '../../../hooks/useCanvasLifecycle'
import { useTranslation } from '../../../i18n'
import type { TabState } from '../../../services/canvas-lifecycle'
import { DiffContent } from '../../diff/DiffContent'

type VersionStatusKind = 'disabled' | 'enabled' | 'external' | 'unsupported' | 'tool_missing' | 'error'
type VersionFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

interface VersionFileChange {
  path: string
  previousPath?: string
  fileName: string
  status: VersionFileStatus
  staged: boolean
  binary: boolean
  added: number
  removed: number
  beforeContent?: string
  afterContent?: string
}

interface VersionSummary {
  totalFiles: number
  totalAdded: number
  totalRemoved: number
}

interface VersionControlStatus {
  kind: VersionStatusKind
  enabled: boolean
  message?: string
  changes: VersionFileChange[]
  summary: VersionSummary
}

interface VersionEntry {
  id: string
  shortId: string
  message: string
  createdAt: string
  fileCount: number
}

interface VersionDiffResult {
  versionId?: string
  files: VersionFileChange[]
  summary: VersionSummary
}

interface VersionControlPanelProps {
  tab: TabState
}

const statusLabel: Record<VersionFileStatus, string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
  renamed: '重命名',
  untracked: '新增',
}

const statusIcon: Record<VersionFileStatus, typeof FileText> = {
  added: FilePlus,
  modified: FileText,
  deleted: FileX,
  renamed: FileText,
  untracked: FilePlus,
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function createDefaultVersionMessage(): string {
  return `保存工作区 ${formatDate(new Date().toISOString())}`
}

function summarize(summary: VersionSummary): string {
  if (summary.totalFiles === 0) return '没有未保存到版本的更改'
  return `${summary.totalFiles} 个文件，+${summary.totalAdded} / -${summary.totalRemoved}`
}

function fileKey(file: VersionFileChange): string {
  return `${file.status}:${file.previousPath || ''}:${file.path}`
}

function EmptyPanel({
  title,
  description,
  icon: Icon,
  action,
}: {
  title: string
  description: string
  icon: typeof AlertTriangle
  action?: React.ReactNode
}) {
  return (
    <div className="flex h-full items-center justify-center bg-background">
      <div className="max-w-md rounded-3xl border border-border/60 bg-card/80 p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/70">
          <Icon className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </div>
  )
}

export function VersionControlPanel({ tab }: VersionControlPanelProps): JSX.Element {
  const { t } = useTranslation()
  const spaceId = tab.spaceId
  const { getDirtyFileTabs, saveDirtyFileTabs, tabs } = useCanvasLifecycle()
  const [status, setStatus] = useState<VersionControlStatus | null>(null)
  const [versions, setVersions] = useState<VersionEntry[]>([])
  const [currentDiff, setCurrentDiff] = useState<VersionDiffResult | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<VersionEntry | null>(null)
  const [selectedDiff, setSelectedDiff] = useState<VersionDiffResult | null>(null)
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null)
  const [versionMessage, setVersionMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  const dirtyTabs = useMemo(
    () => spaceId ? getDirtyFileTabs(spaceId) : [],
    [getDirtyFileTabs, spaceId, tabs]
  )
  const activeDiff = selectedVersion ? selectedDiff : currentDiff
  const activeFiles = activeDiff?.files || []
  const activeSelectedFile = useMemo(() => {
    if (activeFiles.length === 0) return null
    return activeFiles.find((file) => fileKey(file) === selectedFileKey) || activeFiles[0]
  }, [activeFiles, selectedFileKey])

  const loadPanel = useCallback(async () => {
    if (!spaceId) return
    setLoading(true)
    setFeedback(null)

    const statusResponse = await api.getVersionStatus(spaceId)
    if (!statusResponse.success) {
      setStatus({
        kind: 'error',
        enabled: false,
        message: statusResponse.error || '版本管理状态读取失败',
        changes: [],
        summary: { totalFiles: 0, totalAdded: 0, totalRemoved: 0 },
      })
      setLoading(false)
      return
    }

    const nextStatus = statusResponse.data as VersionControlStatus
    setStatus(nextStatus)

    if (!nextStatus.enabled) {
      setVersions([])
      setCurrentDiff(null)
      setSelectedVersion(null)
      setSelectedDiff(null)
      setLoading(false)
      return
    }

    const [versionsResponse, diffResponse] = await Promise.all([
      api.listVersions(spaceId, 30),
      api.getVersionDiff(spaceId),
    ])

    setVersions(versionsResponse.success && versionsResponse.data ? versionsResponse.data as VersionEntry[] : [])
    setCurrentDiff(diffResponse.success && diffResponse.data ? diffResponse.data as VersionDiffResult : {
      files: nextStatus.changes,
      summary: nextStatus.summary,
    })
    setLoading(false)
  }, [spaceId])

  useEffect(() => {
    void loadPanel()
  }, [loadPanel])

  const handleInit = async () => {
    if (!spaceId) return
    setActionLoading('init')
    setFeedback(null)
    const response = await api.initVersionControl(spaceId)
    setActionLoading(null)
    if (!response.success) {
      setFeedback({ type: 'error', text: response.error || '开启版本管理失败' })
      return
    }
    setFeedback({ type: 'success', text: '版本管理已开启' })
    await loadPanel()
  }

  const createVersion = async (skipDirtyCheck = false) => {
    if (!spaceId) return
    if (!skipDirtyCheck && dirtyTabs.length > 0) {
      setFeedback({ type: 'info', text: '还有打开的文件未保存，先保存这些内容后再创建版本。' })
      return
    }

    setActionLoading('create')
    setFeedback(null)
    const message = versionMessage.trim() || createDefaultVersionMessage()
    const response = await api.createVersion(spaceId, message)
    setActionLoading(null)

    if (!response.success) {
      setFeedback({ type: 'error', text: response.error || '保存版本失败' })
      return
    }

    if (!response.data) {
      setFeedback({ type: 'info', text: '当前没有需要保存的更改。' })
      return
    }

    setVersionMessage('')
    setSelectedVersion(null)
    setSelectedDiff(null)
    setSelectedFileKey(null)
    setFeedback({ type: 'success', text: '已保存为版本' })
    await loadPanel()
  }

  const saveDirtyThenCreate = async () => {
    if (!spaceId) return
    setActionLoading('dirty')
    const result = await saveDirtyFileTabs(spaceId)
    setActionLoading(null)

    if (result.failed.length > 0) {
      setFeedback({ type: 'error', text: `有 ${result.failed.length} 个打开文件保存失败，请处理后重试。` })
      return
    }

    await createVersion(true)
  }

  const loadVersionDiff = async (version: VersionEntry | null) => {
    if (!spaceId) return
    setSelectedVersion(version)
    setSelectedFileKey(null)
    if (!version) {
      setSelectedDiff(null)
      return
    }

    setActionLoading(`version:${version.id}`)
    const response = await api.getVersionDiff(spaceId, { versionId: version.id })
    setActionLoading(null)
    if (!response.success) {
      setFeedback({ type: 'error', text: response.error || '读取版本变化失败' })
      return
    }
    setSelectedDiff(response.data as VersionDiffResult)
  }

  const discardFile = async (file: VersionFileChange) => {
    if (!spaceId) return
    if (!window.confirm(`要放弃「${file.path}」的当前更改吗？`)) return
    setActionLoading(`discard:${file.path}`)
    const response = await api.discardVersionFile(spaceId, file.path)
    setActionLoading(null)
    if (!response.success) {
      setFeedback({ type: 'error', text: response.error || '放弃更改失败' })
      return
    }
    setFeedback({ type: 'success', text: '文件已恢复到最新版本' })
    await loadPanel()
  }

  const restoreFile = async (file: VersionFileChange) => {
    if (!spaceId || !selectedVersion) return
    if (!window.confirm(`要把「${file.path}」恢复到所选版本吗？恢复后会成为当前工作区更改。`)) return
    setActionLoading(`restore:${file.path}`)
    const response = await api.restoreVersionFile(spaceId, file.path, selectedVersion.id)
    setActionLoading(null)
    if (!response.success) {
      setFeedback({ type: 'error', text: response.error || '恢复文件失败' })
      return
    }
    setSelectedVersion(null)
    setSelectedDiff(null)
    setFeedback({ type: 'success', text: '文件已恢复到当前工作区' })
    await loadPanel()
  }

  if (!spaceId) {
    return (
      <EmptyPanel
        icon={AlertTriangle}
        title={t('无法打开版本管理')}
        description={t('当前标签没有绑定工作区。')}
      />
    )
  }

  if (loading || !status) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('正在读取版本管理状态...')}
        </div>
      </div>
    )
  }

  if (status.kind === 'disabled') {
    return (
      <EmptyPanel
        icon={History}
        title={t('开启版本管理')}
        description={t('Kite 会在当前工作区内保存恢复点，方便你管理文档、代码和 AI 修改后的结果。')}
        action={
          <button
            onClick={handleInit}
            disabled={actionLoading === 'init'}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {actionLoading === 'init' ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
            {t('开启版本管理')}
          </button>
        }
      />
    )
  }

  if (!status.enabled) {
    return (
      <EmptyPanel
        icon={AlertTriangle}
        title={status.kind === 'external' ? t('当前工作区已有外部版本结构') : t('版本管理不可用')}
        description={status.message || t('版本管理暂时无法接管当前工作区。')}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 bg-background">
      <aside className="flex w-[320px] shrink-0 flex-col border-r border-border/60 bg-card/45">
        <div className="border-b border-border/60 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-foreground">{t('版本管理')}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{summarize(status.summary)}</p>
            </div>
            <button
              onClick={() => void loadPanel()}
              className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
              title={t('刷新')}
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-4 space-y-2">
            {dirtyTabs.length > 0 && (
              <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-200">
                <div className="font-medium">{t('还有未保存内容')}</div>
                <div className="mt-1 text-amber-700/80 dark:text-amber-200/80">
                  {t('{{count}} 个打开文件尚未落盘，版本不会自动包含它们。', { count: dirtyTabs.length })}
                </div>
                <button
                  onClick={saveDirtyThenCreate}
                  disabled={actionLoading === 'dirty' || actionLoading === 'create'}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-500/15 px-2.5 py-1.5 font-medium hover:bg-amber-500/25 disabled:opacity-50"
                >
                  {actionLoading === 'dirty' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {t('保存打开文件后继续')}
                </button>
              </div>
            )}

            <textarea
              value={versionMessage}
              onChange={(event) => setVersionMessage(event.target.value)}
              rows={3}
              placeholder={t('写一句版本说明，例如：完成首页文案调整')}
              className="w-full resize-none rounded-xl border border-border bg-background/70 px-3 py-2 text-sm outline-none focus:border-primary/60"
            />
            <button
              onClick={() => void createVersion(false)}
              disabled={actionLoading === 'create'}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {actionLoading === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {t('保存当前工作区为版本')}
            </button>
          </div>

          {feedback && (
            <div className={`mt-3 rounded-xl px-3 py-2 text-xs ${
              feedback.type === 'error'
                ? 'bg-destructive/10 text-destructive'
                : feedback.type === 'success'
                  ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'bg-secondary text-muted-foreground'
            }`}>
              {feedback.text}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <button
            onClick={() => void loadVersionDiff(null)}
            className={`mb-3 flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
              selectedVersion
                ? 'border-border bg-background/60 hover:bg-secondary/60'
                : 'border-primary/35 bg-primary/10 text-foreground'
            }`}
          >
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              {t('当前更改')}
            </span>
            <span className="text-xs text-muted-foreground">{status.summary.totalFiles}</span>
          </button>

          <div className="mb-2 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
            {t('历史版本')}
          </div>
          <div className="space-y-1.5">
            {versions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                {t('还没有历史版本')}
              </div>
            ) : versions.map((version) => (
              <button
                key={version.id}
                onClick={() => void loadVersionDiff(version)}
                className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  selectedVersion?.id === version.id
                    ? 'border-primary/35 bg-primary/10'
                    : 'border-border/60 bg-background/50 hover:bg-secondary/60'
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate font-medium text-foreground">{version.message}</span>
                  {actionLoading === `version:${version.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{formatDate(version.createdAt)}</span>
                  <span>{version.fileCount} {t('个文件')}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-3">
          <div>
            <div className="text-sm font-medium text-foreground">
              {selectedVersion ? selectedVersion.message : t('当前工作区变化')}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {summarize(activeDiff?.summary || { totalFiles: 0, totalAdded: 0, totalRemoved: 0 })}
            </div>
          </div>
          {selectedVersion ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
              <History className="h-3.5 w-3.5" />
              {formatDate(selectedVersion.createdAt)}
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t('恢复操作会成为当前更改')}
            </div>
          )}
        </div>

        {activeFiles.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {selectedVersion ? t('这个版本没有可展示的文件变化') : t('当前没有文件变化')}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
            <div className="overflow-y-auto border-r border-border/60 p-3">
              <div className="space-y-1.5">
                {activeFiles.map((file) => {
                  const Icon = statusIcon[file.status]
                  const selected = activeSelectedFile && fileKey(file) === fileKey(activeSelectedFile)
                  return (
                    <button
                      key={fileKey(file)}
                      onClick={() => setSelectedFileKey(fileKey(file))}
                      className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                        selected
                          ? 'border-primary/35 bg-primary/10'
                          : 'border-border/50 bg-card/45 hover:bg-secondary/60'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-foreground">{file.path}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{t(statusLabel[file.status])}</span>
                        {file.binary ? (
                          <span>{t('二进制文件')}</span>
                        ) : (
                          <span>
                            <span className="text-emerald-500">+{file.added}</span>
                            <span className="mx-1 text-muted-foreground/40">/</span>
                            <span className="text-red-500">-{file.removed}</span>
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="min-w-0 overflow-y-auto p-4">
              {activeSelectedFile && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{activeSelectedFile.path}</div>
                      {activeSelectedFile.previousPath ? (
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t('来自')} {activeSelectedFile.previousPath}
                        </div>
                      ) : null}
                    </div>
                    {selectedVersion ? (
                      <button
                        onClick={() => void restoreFile(activeSelectedFile)}
                        disabled={actionLoading === `restore:${activeSelectedFile.path}`}
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50"
                      >
                        {actionLoading === `restore:${activeSelectedFile.path}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                        {t('恢复此文件')}
                      </button>
                    ) : (
                      <button
                        onClick={() => void discardFile(activeSelectedFile)}
                        disabled={actionLoading === `discard:${activeSelectedFile.path}`}
                        className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs text-foreground hover:bg-secondary disabled:opacity-50"
                      >
                        {actionLoading === `discard:${activeSelectedFile.path}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                        {t('放弃此文件更改')}
                      </button>
                    )}
                  </div>

                  {activeSelectedFile.binary ? (
                    <div className="rounded-2xl border border-border bg-card/60 p-6 text-sm text-muted-foreground">
                      {t('二进制文件无法预览变化，可以直接恢复或放弃更改。')}
                    </div>
                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-border bg-card/60">
                      <DiffContent
                        type={activeSelectedFile.status === 'added' || activeSelectedFile.status === 'untracked' ? 'write' : 'edit'}
                        oldString={activeSelectedFile.beforeContent || ''}
                        newString={activeSelectedFile.afterContent || ''}
                        content={activeSelectedFile.afterContent || ''}
                        fileName={activeSelectedFile.fileName}
                        stats={{ added: activeSelectedFile.added, removed: activeSelectedFile.removed }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
