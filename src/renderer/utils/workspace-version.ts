import { api } from '../api'
import type { TabState, SaveDirtyFileTabsResult } from '../services/canvas-lifecycle'

interface SaveWorkspaceVersionOptions {
  spaceId: string
  getDirtyFileTabs: (spaceId: string) => TabState[]
  saveDirtyFileTabs: (spaceId: string) => Promise<SaveDirtyFileTabsResult>
}

function defaultVersionMessage(): string {
  const timestamp = new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date())
  return `保存当前工作区 ${timestamp}`
}

export async function saveWorkspaceVersion({
  spaceId,
  getDirtyFileTabs,
  saveDirtyFileTabs,
}: SaveWorkspaceVersionOptions): Promise<'saved' | 'empty'> {
  const dirtyTabs = getDirtyFileTabs(spaceId)
  if (dirtyTabs.length > 0) {
    const result = await saveDirtyFileTabs(spaceId)
    if (result.failed.length > 0) {
      throw new Error(`有 ${result.failed.length} 个打开文件保存失败，请处理后重试。`)
    }
  }

  const statusResponse = await api.getVersionStatus(spaceId)
  if (!statusResponse.success) {
    throw new Error(statusResponse.error || '版本管理状态读取失败')
  }

  const status = statusResponse.data as { kind: string; enabled: boolean; message?: string }
  if (!status.enabled) {
    if (status.kind === 'disabled') {
      const initResponse = await api.initVersionControl(spaceId)
      if (!initResponse.success) {
        throw new Error(initResponse.error || '开启版本管理失败')
      }
      return 'saved'
    } else {
      throw new Error(status.message || '版本管理暂时无法接管当前工作区。')
    }
  }

  const createResponse = await api.createVersion(spaceId, defaultVersionMessage())
  if (!createResponse.success) {
    throw new Error(createResponse.error || '保存版本失败')
  }

  return createResponse.data ? 'saved' : 'empty'
}
