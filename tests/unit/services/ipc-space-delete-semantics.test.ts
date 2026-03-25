import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcMain } from 'electron'

const deleteSpaceMock = vi.fn()

vi.mock('../../../src/main/services/space.service', () => ({
  getKiteSpace: vi.fn(() => ({})),
  listSpaces: vi.fn(() => []),
  createSpace: vi.fn(() => ({})),
  deleteSpace: (...args: unknown[]) => deleteSpaceMock(...args),
  getSpace: vi.fn(() => null),
  openSpaceFolder: vi.fn(() => false),
  updateSpace: vi.fn(() => null),
  updateSpacePreferences: vi.fn(() => null),
  getSpacePreferences: vi.fn(() => undefined)
}))

vi.mock('../../../src/main/services/config.service', () => ({
  getSpacesDir: vi.fn(() => '/tmp/spaces')
}))

import { registerSpaceHandlers } from '../../../src/main/ipc/space'

describe('ipc space:delete semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('space.service.deleteSpace 返回 false 时，IPC 必须返回 success=false', async () => {
    deleteSpaceMock.mockReturnValueOnce(false)
    registerSpaceHandlers()

    const calls = (ipcMain.handle as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const entry = calls.find((call) => call[0] === 'space:delete')
    expect(entry).toBeDefined()

    const handler = entry?.[1] as (event: unknown, spaceId: string) => Promise<{ success: boolean; error?: string }>
    const result = await handler({}, 'space-a')

    expect(deleteSpaceMock).toHaveBeenCalledWith('space-a')
    expect(result.success).toBe(false)
  })

  it('space.service.deleteSpace 返回 true 时，IPC 返回 success=true 且 data=true', async () => {
    deleteSpaceMock.mockReturnValueOnce(true)
    registerSpaceHandlers()

    const calls = (ipcMain.handle as unknown as { mock: { calls: unknown[][] } }).mock.calls
    const entry = calls.find((call) => call[0] === 'space:delete')
    expect(entry).toBeDefined()

    const handler = entry?.[1] as (event: unknown, spaceId: string) => Promise<{ success: boolean; data?: boolean }>
    const result = await handler({}, 'space-a')

    expect(result).toEqual({ success: true, data: true })
  })
})
