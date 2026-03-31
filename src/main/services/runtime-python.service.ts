import { execSync, spawnSync } from 'child_process'

const PYTHON_CANDIDATES = ['python3', 'python']
const REQUIRED_MODULES = ['json', 'pathlib']

export interface PythonRuntimeStatus {
  found: boolean
  pythonCommand: string | null
  pythonVersion: string | null
  pipReady: boolean
  missingModules: string[]
  installSupported: boolean
  installStrategy: 'windows-system-silent' | 'manual-guidance'
}

function tryGetVersion(command: string): string | null {
  const result = spawnSync(command, ['--version'], { encoding: 'utf-8', windowsHide: true })
  if (result.status !== 0) return null
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return output || null
}

function probePythonCommand(): { command: string; version: string } | null {
  for (const command of PYTHON_CANDIDATES) {
    const version = tryGetVersion(command)
    if (version) {
      return { command, version }
    }
  }
  return null
}

function checkPip(command: string): boolean {
  const result = spawnSync(command, ['-m', 'pip', '--version'], { encoding: 'utf-8', windowsHide: true })
  return result.status === 0
}

function checkMissingModules(command: string): string[] {
  const moduleList = REQUIRED_MODULES.join(',')
  const code = `import importlib.util;mods="${moduleList}".split(",");missing=[m for m in mods if importlib.util.find_spec(m) is None];print(",".join(missing))`
  const result = spawnSync(command, ['-c', code], { encoding: 'utf-8', windowsHide: true })
  if (result.status !== 0) {
    return [...REQUIRED_MODULES]
  }
  const output = (result.stdout ?? '').trim()
  return output.length > 0 ? output.split(',').filter(Boolean) : []
}

export function getPythonRuntimeStatus(): PythonRuntimeStatus {
  const runtime = probePythonCommand()
  if (!runtime) {
    return {
      found: false,
      pythonCommand: null,
      pythonVersion: null,
      pipReady: false,
      missingModules: [...REQUIRED_MODULES],
      installSupported: process.platform === 'win32',
      installStrategy: process.platform === 'win32' ? 'windows-system-silent' : 'manual-guidance'
    }
  }

  return {
    found: true,
    pythonCommand: runtime.command,
    pythonVersion: runtime.version,
    pipReady: checkPip(runtime.command),
    missingModules: checkMissingModules(runtime.command),
    installSupported: process.platform === 'win32',
    installStrategy: process.platform === 'win32' ? 'windows-system-silent' : 'manual-guidance'
  }
}

export function installPythonRuntimeSilently(): { success: boolean; status: PythonRuntimeStatus; error?: string } {
  if (process.platform !== 'win32') {
    return {
      success: false,
      status: getPythonRuntimeStatus(),
      error: 'Automatic Python installation is only supported on Windows.'
    }
  }

  try {
    execSync(
      'winget install --id Python.Python.3.12 --exact --scope machine --silent --accept-package-agreements --accept-source-agreements',
      { stdio: 'pipe', windowsHide: true }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      success: false,
      status: getPythonRuntimeStatus(),
      error: `Silent install failed: ${message}`
    }
  }

  const status = getPythonRuntimeStatus()
  if (!status.found) {
    return {
      success: false,
      status,
      error: 'Silent install completed but Python is still not available on PATH.'
    }
  }

  return { success: true, status }
}
