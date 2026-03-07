import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'

type LockSource = 'package-lock.json' | 'pnpm-lock.yaml'

const WATCHED_PACKAGES = [
  '@anthropic-ai/claude-code',
  '@anthropic-ai/sdk',
  '@anthropic-ai/claude-agent-sdk'
] as const

type WatchedPackageName = (typeof WATCHED_PACKAGES)[number]

export interface DependencyVersionSnapshot {
  packageName: WatchedPackageName
  installedVersion: string | null
  packageLockVersion: string | null
  pnpmLockVersion: string | null
}

export interface DependencyConsistencyWarning {
  code: 'lockfile_divergence' | 'installed_mismatch'
  message: string
  packageName?: WatchedPackageName
  lockSource?: LockSource
}

export interface DependencyConsistencyEvaluationResult {
  dependencies: DependencyVersionSnapshot[]
  warnings: DependencyConsistencyWarning[]
  hasIssues: boolean
}

export interface EvaluateDependencyConsistencyInput {
  hasPackageLock: boolean
  hasPnpmLock: boolean
  packageLockJson?: unknown
  pnpmLockText?: string
  installedVersions: Record<string, string | null | undefined>
}

export interface DependencyConsistencySelfCheckReport
  extends DependencyConsistencyEvaluationResult {
  rootDir: string
  hasPackageLock: boolean
  hasPnpmLock: boolean
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripPnpmVersionDecorators(version: string): string {
  return version.split('(')[0].trim()
}

function readInstalledVersion(rootDir: string, packageName: WatchedPackageName): string | null {
  try {
    const packageJsonPath = join(rootDir, 'node_modules', packageName, 'package.json')
    if (!existsSync(packageJsonPath)) return null
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

function findProjectRoot(startDir: string): string | null {
  let current = resolve(startDir)

  while (true) {
    if (existsSync(join(current, 'package.json'))) {
      return current
    }

    const parent = dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

export function extractPackageLockVersion(
  packageLockJson: unknown,
  packageName: string
): string | null {
  if (!packageLockJson || typeof packageLockJson !== 'object') return null
  const packages = (packageLockJson as { packages?: Record<string, { version?: unknown }> }).packages
  if (!packages || typeof packages !== 'object') return null
  const entry = packages[`node_modules/${packageName}`]
  if (!entry || typeof entry !== 'object') return null
  return typeof entry.version === 'string' ? entry.version : null
}

export function extractPnpmImporterVersion(
  pnpmLockText: string,
  packageName: string
): string | null {
  const escaped = escapeRegExp(packageName)
  const directDependencyPattern = new RegExp(
    `'${escaped}':\\s*\\n\\s*specifier:\\s*[^\\n\\r]+\\n\\s*version:\\s*([^\\n\\r]+)`,
    'm'
  )
  const directMatch = pnpmLockText.match(directDependencyPattern)
  if (directMatch?.[1]) {
    return stripPnpmVersionDecorators(directMatch[1])
  }

  const lockEntryPattern = new RegExp(`^\\s*'${escaped}@([^':]+)':`, 'm')
  const lockEntryMatch = pnpmLockText.match(lockEntryPattern)
  if (lockEntryMatch?.[1]) {
    return stripPnpmVersionDecorators(lockEntryMatch[1])
  }

  return null
}

export function evaluateDependencyConsistency(
  input: EvaluateDependencyConsistencyInput
): DependencyConsistencyEvaluationResult {
  const warnings: DependencyConsistencyWarning[] = []

  const dependencies = WATCHED_PACKAGES.map((packageName) => {
    const packageLockVersion = input.hasPackageLock
      ? extractPackageLockVersion(input.packageLockJson, packageName)
      : null
    const pnpmLockVersion = input.hasPnpmLock
      ? extractPnpmImporterVersion(input.pnpmLockText || '', packageName)
      : null
    const installedVersion = input.installedVersions[packageName] || null

    if (packageLockVersion && pnpmLockVersion && packageLockVersion !== pnpmLockVersion) {
      warnings.push({
        code: 'lockfile_divergence',
        packageName,
        message: `Lockfile divergence for ${packageName}: package-lock=${packageLockVersion}, pnpm-lock=${pnpmLockVersion}`
      })
    }

    if (installedVersion && packageLockVersion && installedVersion !== packageLockVersion) {
      warnings.push({
        code: 'installed_mismatch',
        packageName,
        lockSource: 'package-lock.json',
        message: `Installed ${packageName}@${installedVersion} mismatches package-lock expected ${packageLockVersion}`
      })
    }

    if (installedVersion && pnpmLockVersion && installedVersion !== pnpmLockVersion) {
      warnings.push({
        code: 'installed_mismatch',
        packageName,
        lockSource: 'pnpm-lock.yaml',
        message: `Installed ${packageName}@${installedVersion} mismatches pnpm-lock expected ${pnpmLockVersion}`
      })
    }

    return {
      packageName,
      installedVersion,
      packageLockVersion,
      pnpmLockVersion
    }
  })

  return {
    dependencies,
    warnings,
    hasIssues: warnings.length > 0
  }
}

export function runDependencyConsistencySelfCheck(
  startDir: string = process.cwd()
): DependencyConsistencySelfCheckReport | null {
  const rootDir = findProjectRoot(startDir)
  if (!rootDir) return null

  const packageLockPath = join(rootDir, 'package-lock.json')
  const pnpmLockPath = join(rootDir, 'pnpm-lock.yaml')

  const hasPackageLock = existsSync(packageLockPath)
  const hasPnpmLock = existsSync(pnpmLockPath)

  let packageLockJson: unknown
  if (hasPackageLock) {
    try {
      packageLockJson = JSON.parse(readFileSync(packageLockPath, 'utf-8'))
    } catch (error) {
      console.warn(
        `[Startup][DependencySelfCheck] Failed to parse package-lock.json: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  let pnpmLockText = ''
  if (hasPnpmLock) {
    try {
      pnpmLockText = readFileSync(pnpmLockPath, 'utf-8')
    } catch (error) {
      console.warn(
        `[Startup][DependencySelfCheck] Failed to read pnpm-lock.yaml: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  const installedVersions: Record<string, string | null> = {}
  for (const packageName of WATCHED_PACKAGES) {
    installedVersions[packageName] = readInstalledVersion(rootDir, packageName)
  }

  const evaluation = evaluateDependencyConsistency({
    hasPackageLock,
    hasPnpmLock,
    packageLockJson,
    pnpmLockText,
    installedVersions
  })

  const report: DependencyConsistencySelfCheckReport = {
    rootDir,
    hasPackageLock,
    hasPnpmLock,
    ...evaluation
  }

  if (report.hasIssues) {
    console.warn(
      `[Startup][DependencySelfCheck] warning ${JSON.stringify({
        event: 'dependency_self_check_warning',
        rootDir: report.rootDir,
        hasPackageLock: report.hasPackageLock,
        hasPnpmLock: report.hasPnpmLock,
        warnings: report.warnings
      })}`
    )
  }

  return report
}
