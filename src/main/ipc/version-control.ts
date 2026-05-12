import { ipcMain } from 'electron'
import {
  createVersion,
  discardVersionFile,
  getVersionControlStatus,
  getVersionDiff,
  initVersionControl,
  listVersions,
  restoreVersionFile,
} from '../services/version-control.service'

function ok<T>(data: T) {
  return { success: true, data }
}

function fail(error: unknown) {
  const err = error as Error & { code?: string }
  return { success: false, error: err.message, errorCode: err.code }
}

export function registerVersionControlHandlers(): void {
  ipcMain.handle('version:get-status', async (_event, spaceId: string) => {
    try { return ok(getVersionControlStatus(spaceId)) } catch (error) { return fail(error) }
  })

  ipcMain.handle('version:init', async (_event, spaceId: string) => {
    try { return ok(initVersionControl(spaceId)) } catch (error) { return fail(error) }
  })

  ipcMain.handle('version:create', async (_event, spaceId: string, message: string) => {
    try { return ok(createVersion(spaceId, message)) } catch (error) { return fail(error) }
  })

  ipcMain.handle('version:list', async (_event, spaceId: string, limit?: number) => {
    try { return ok(listVersions(spaceId, limit)) } catch (error) { return fail(error) }
  })

  ipcMain.handle('version:get-diff', async (_event, spaceId: string, options?: { versionId?: string }) => {
    try { return ok(getVersionDiff(spaceId, options)) } catch (error) { return fail(error) }
  })

  ipcMain.handle('version:restore-file', async (_event, spaceId: string, filePath: string, versionId: string) => {
    try { return ok(restoreVersionFile(spaceId, filePath, versionId)) } catch (error) { return fail(error) }
  })

  ipcMain.handle('version:discard-file', async (_event, spaceId: string, filePath: string) => {
    try { return ok(discardVersionFile(spaceId, filePath)) } catch (error) { return fail(error) }
  })
}
