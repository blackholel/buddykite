import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'

const createArtifactEntryMock = vi.fn()
const generateMarkdownExportTitleMock = vi.fn()

vi.mock('../../../src/main/services/artifact.service', () => ({
  listArtifacts: vi.fn(() => []),
  listArtifactsTree: vi.fn(() => []),
  readArtifactContent: vi.fn(() => ({ content: '', mimeType: 'text/plain', encoding: 'utf-8', size: 0 })),
  writeArtifactContent: vi.fn(async () => ({ success: true })),
  createArtifactEntry: (...args: unknown[]) => createArtifactEntryMock(...args),
  createFolder: vi.fn(async () => ({ success: true })),
  createFile: vi.fn(async () => ({ success: true })),
  renameArtifact: vi.fn(async () => ({ success: true })),
  deleteArtifact: vi.fn(async () => ({ success: true })),
  moveArtifact: vi.fn(async () => ({ success: true })),
  copyArtifact: vi.fn(async () => ({ success: true }))
}))

vi.mock('../../../src/main/services/markdown-export-title.service', () => ({
  generateMarkdownExportTitle: (...args: unknown[]) => generateMarkdownExportTitleMock(...args)
}))

import { registerArtifactHandlers } from '../../../src/main/ipc/artifact'

describe('ipc artifact:create-entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('按原样透传参数给 artifact service', async () => {
    createArtifactEntryMock.mockResolvedValueOnce({ success: true })
    registerArtifactHandlers()

    const calls = (ipcMain.handle as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const entry = calls.find((call) => call[0] === 'artifact:create-entry')
    expect(entry).toBeDefined()

    const handler = entry?.[1] as (event: unknown, params: unknown) => Promise<{ success: boolean }>
    const params = {
      type: 'file',
      parentPath: '/workspace/project',
      name: 'README.md'
    }
    const result = await handler({}, params)

    expect(createArtifactEntryMock).toHaveBeenCalledTimes(1)
    expect(createArtifactEntryMock).toHaveBeenCalledWith(params)
    expect(result.success).toBe(true)
  })

  it('按原样透传标题生成参数给 markdown export title service', async () => {
    generateMarkdownExportTitleMock.mockResolvedValueOnce({
      title: '导出标题',
      source: 'ai'
    })
    registerArtifactHandlers()

    const calls = (ipcMain.handle as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const entry = calls.find((call) => call[0] === 'artifact:generate-export-title')
    expect(entry).toBeDefined()

    const handler = entry?.[1] as (event: unknown, params: unknown) => Promise<{
      success: boolean
      data?: unknown
    }>
    const params = {
      userPrompt: '问题',
      assistantText: '回答',
      widgetTitles: ['图表']
    }
    const result = await handler({}, params)

    expect(generateMarkdownExportTitleMock).toHaveBeenCalledTimes(1)
    expect(generateMarkdownExportTitleMock).toHaveBeenCalledWith(params)
    expect(result).toEqual({
      success: true,
      data: {
        title: '导出标题',
        source: 'ai'
      }
    })
  })
})
