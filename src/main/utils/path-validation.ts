/**
 * Path validation utilities
 *
 * Provides security-focused path validation to prevent symlink attacks
 * and ensure paths point to valid directories.
 */

import { lstatSync, existsSync, realpathSync, statSync, type Stats } from 'fs'
import { resolve, relative, isAbsolute, dirname } from 'path'

export const FS_BOUNDARY_VIOLATION = 'FS_BOUNDARY_VIOLATION'

/**
 * Normalize a file path for cross-platform comparison.
 * Resolves to absolute and lowercases on Windows.
 */
export function normalizePlatformPath(value: string): string {
  const resolved = resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

/**
 * Validate that a path is a valid directory and not a symlink
 *
 * @param dirPath - Path to validate
 * @param context - Context for logging (e.g., 'Plugins', 'Agents')
 * @returns true if path is a valid directory, false otherwise
 */
export function isValidDirectoryPath(dirPath: string, context: string = 'Path'): boolean {
  try {
    const stat = lstatSync(dirPath)
    if (stat.isSymbolicLink()) {
      console.warn(`[${context}] Security: Rejected symlink path: ${dirPath}`)
      return false
    }
    return stat.isDirectory()
  } catch {
    return false
  }
}

/**
 * Validate that a path is within one of the allowed base paths
 *
 * @param targetPath - Path to validate
 * @param basePaths - Allowed base directories
 * @returns true if targetPath is inside any base path (or equals it)
 */
export function isPathWithinBasePaths(targetPath: string, basePaths: string[]): boolean {
  if (!targetPath || basePaths.length === 0) return false

  const resolvedTarget = normalizePlatformPath(targetPath)

  return basePaths.some((basePath) => {
    if (!basePath) return false
    const resolvedBase = normalizePlatformPath(basePath)
    if (resolvedTarget === resolvedBase) return true
    const rel = relative(resolvedBase, resolvedTarget)
    return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
  })
}

/**
 * Validate that a path is one of the allowed workspace (space) directories.
 *
 * @param workDir - Path to validate
 * @param allowedPaths - List of allowed workspace paths (e.g. from getAllSpacePaths())
 * @returns true if workDir is exactly one of the allowed paths
 */
export function isWorkDirAllowed(workDir: string, allowedPaths?: string[]): boolean {
  if (!workDir) return false

  // When no explicit list is provided, dynamically resolve from space service
  let paths = allowedPaths
  if (!paths) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const spaceService = require('../services/space.service') as {
        getAllSpacePaths: () => string[]
      }
      paths = spaceService.getAllSpacePaths()
    } catch {
      return false
    }
  }

  const resolved = normalizePlatformPath(workDir)
  return paths.some((spacePath) => spacePath && normalizePlatformPath(spacePath) === resolved)
}

/**
 * Check if an error represents a file-not-found condition (ENOENT / ENOTDIR)
 *
 * Use this to decide log severity: file-not-found → debug, others → warn.
 */
export function isFileNotFoundError(error: unknown): boolean {
  if (error instanceof Error && 'code' in error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR'
  }
  return false
}

function safeRealpath(pathValue: string): string | null {
  try {
    return normalizePlatformPath(realpathSync(pathValue))
  } catch {
    return null
  }
}

function safeStat(pathValue: string): Stats | null {
  try {
    return statSync(pathValue)
  } catch {
    return null
  }
}

function findNearestExistingAncestor(pathValue: string): string | null {
  let current = normalizePlatformPath(pathValue)
  while (true) {
    if (existsSync(current)) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  if (targetPath === rootPath) return true
  const rel = relative(rootPath, targetPath)
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

function createBoundaryDenyResult(
  reason: string,
  resolvedPath: string,
  rootRealPath: string
): WorkspaceBoundaryValidationResult {
  return {
    allowed: false,
    errorCode: FS_BOUNDARY_VIOLATION,
    reason,
    resolvedPath,
    rootRealPath
  }
}

export interface WorkspaceBoundaryValidationResult {
  allowed: boolean
  resolvedPath: string
  rootRealPath: string
  inspectedRealPath?: string
  errorCode?: typeof FS_BOUNDARY_VIOLATION
  reason?: string
}

/**
 * Validate candidate path against workspace root using realpath + inode checks.
 * - Rejects traversal/symlink escapes outside workspace root.
 * - Rejects cross-device inode access against workspace root.
 * - For non-existing target paths, validates nearest existing ancestor.
 */
export function validatePathWithinWorkspaceBoundary(
  candidatePath: string,
  workspaceRoot: string
): WorkspaceBoundaryValidationResult {
  const resolvedPath = normalizePlatformPath(candidatePath)
  const normalizedRoot = normalizePlatformPath(workspaceRoot)
  const rootExists = existsSync(normalizedRoot)
  if (!rootExists) {
    if (!isPathWithinBasePaths(resolvedPath, [normalizedRoot])) {
      return createBoundaryDenyResult(
        `Target path is outside workspace root: ${resolvedPath}`,
        resolvedPath,
        normalizedRoot
      )
    }
    return {
      allowed: true,
      resolvedPath,
      rootRealPath: normalizedRoot,
      inspectedRealPath: normalizedRoot
    }
  }

  const rootRealPath = safeRealpath(normalizedRoot) || normalizedRoot
  const rootStat = safeStat(rootRealPath)

  const candidateExists = existsSync(resolvedPath)
  const inspectedPath = candidateExists
    ? resolvedPath
    : findNearestExistingAncestor(resolvedPath)

  if (!inspectedPath) {
    return createBoundaryDenyResult(
      'Target path has no existing ancestor to validate',
      resolvedPath,
      rootRealPath
    )
  }

  const inspectedRealPath = safeRealpath(inspectedPath) || normalizePlatformPath(inspectedPath)
  if (!isPathInsideRoot(inspectedRealPath, rootRealPath)) {
    return createBoundaryDenyResult(
      `Resolved path escapes workspace root: ${inspectedRealPath}`,
      resolvedPath,
      rootRealPath
    )
  }

  const inspectedStat = safeStat(inspectedRealPath)
  if (rootStat && inspectedStat && rootStat.dev !== inspectedStat.dev) {
    return createBoundaryDenyResult(
      `Cross-root inode/device access detected: root(dev=${rootStat.dev}) target(dev=${inspectedStat.dev})`,
      resolvedPath,
      rootRealPath
    )
  }

  return {
    allowed: true,
    resolvedPath,
    rootRealPath,
    inspectedRealPath
  }
}
