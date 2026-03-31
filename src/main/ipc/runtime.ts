import { ipcMain } from 'electron'
import { getPythonRuntimeStatus, installPythonRuntimeSilently } from '../services/runtime-python.service'

export function registerRuntimeHandlers(): void {
  ipcMain.handle('runtime:python-status', async () => {
    try {
      return { success: true, data: getPythonRuntimeStatus() }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('runtime:python-install', async () => {
    try {
      const result = installPythonRuntimeSilently()
      return result.success
        ? { success: true, data: result.status }
        : { success: false, error: result.error, data: result.status }
    } catch (error: unknown) {
      const err = error as Error
      return { success: false, error: err.message }
    }
  })
}
