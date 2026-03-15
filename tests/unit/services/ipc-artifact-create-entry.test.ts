import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'

const createArtifactEntryMock = vi.fn()

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
})

