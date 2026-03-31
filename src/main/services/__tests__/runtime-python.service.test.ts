import { beforeEach, describe, expect, it, vi } from 'vitest'

const { spawnSyncMock, execSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
  execSyncMock: vi.fn()
}))

vi.mock('child_process', () => ({
  spawnSync: spawnSyncMock,
  execSync: execSyncMock
}))

import { getPythonRuntimeStatus, installPythonRuntimeSilently } from '../runtime-python.service'

describe('runtime-python.service', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('检测到 Python 与 pip 时返回 ready 状态', () => {
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'python3' && args[0] === '--version') {
        return { status: 0, stdout: 'Python 3.12.2', stderr: '' }
      }
      if (cmd === 'python3' && args[0] === '-m' && args[1] === 'pip') {
        return { status: 0, stdout: 'pip 24.0', stderr: '' }
      }
      if (cmd === 'python3' && args[0] === '-c') {
        return { status: 0, stdout: '', stderr: '' }
      }
      return { status: 1, stdout: '', stderr: '' }
    })

    const status = getPythonRuntimeStatus()
    expect(status.found).toBe(true)
    expect(status.pythonCommand).toBe('python3')
    expect(status.pipReady).toBe(true)
    expect(status.missingModules).toEqual([])
  })

  it('未检测到 Python 时返回 missing 状态', () => {
    spawnSyncMock.mockReturnValue({ status: 1, stdout: '', stderr: 'not found' })

    const status = getPythonRuntimeStatus()
    expect(status.found).toBe(false)
    expect(status.pythonCommand).toBeNull()
    expect(status.pipReady).toBe(false)
    expect(status.missingModules.length).toBeGreaterThan(0)
  })

  it('Windows 静默安装成功后返回 success', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    spawnSyncMock.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === 'python3' && args[0] === '--version') {
        return { status: 0, stdout: 'Python 3.12.2', stderr: '' }
      }
      if (cmd === 'python3' && args[0] === '-m' && args[1] === 'pip') {
        return { status: 0, stdout: 'pip 24.0', stderr: '' }
      }
      if (cmd === 'python3' && args[0] === '-c') {
        return { status: 0, stdout: '', stderr: '' }
      }
      return { status: 1, stdout: '', stderr: '' }
    })
    execSyncMock.mockReturnValue(Buffer.from('ok'))

    const result = installPythonRuntimeSilently()
    expect(result.success).toBe(true)
    expect(execSyncMock).toHaveBeenCalledTimes(1)
    expect(result.status.found).toBe(true)
  })
})
