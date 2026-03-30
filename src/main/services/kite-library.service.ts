import { existsSync, mkdirSync, readdirSync, renameSync, copyFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, join, posix as pathPosix, relative, resolve, sep, win32 as pathWin32 } from 'path'
import { getConfigDir } from '../utils/instance'

const LEGACY_MIGRATION_MARKER_FILE = 'resource-library-migration.v1.json'

function resolveKiteLibraryRootFromConfigDir(
  configDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'win32') {
    const normalizedConfigDir = pathWin32.resolve(configDir)
    const configBaseName = pathWin32.basename(normalizedConfigDir)
    const isDotKiteDir = configBaseName.toLowerCase() === '.kite'

    if (isDotKiteDir) {
      return pathWin32.resolve(pathWin32.join(pathWin32.dirname(normalizedConfigDir), 'kite'))
    }

    return pathWin32.resolve(pathWin32.join(normalizedConfigDir, 'kite'))
  }

  const normalizedConfigDir = pathPosix.resolve(configDir)
  const configBaseName = basename(normalizedConfigDir)
  const isDotKiteDir = configBaseName === '.kite'

  if (isDotKiteDir) {
    return pathPosix.resolve(join(dirname(normalizedConfigDir), 'kite'))
  }

  return pathPosix.resolve(join(normalizedConfigDir, 'kite'))
}

function getLegacyMigrationMarkerPath(configDir: string): string {
  return join(configDir, LEGACY_MIGRATION_MARKER_FILE)
}

function isPathInside(baseDir: string, targetPath: string): boolean {
  const rel = relative(baseDir, targetPath)
  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(`..${sep}`)
}

function copyDirectoryRecursively(sourceDir: string, targetDir: string): void {
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true })
  }

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name)
    const targetPath = join(targetDir, entry.name)

    if (entry.isDirectory()) {
      copyDirectoryRecursively(sourcePath, targetPath)
      continue
    }

    if (entry.isFile()) {
      copyFileSync(sourcePath, targetPath)
    }
  }
}

function moveEntry(sourcePath: string, targetPath: string): void {
  try {
    renameSync(sourcePath, targetPath)
    return
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EXDEV') {
      throw error
    }
  }

  const sourceStats = statSync(sourcePath)
  if (sourceStats.isDirectory()) {
    copyDirectoryRecursively(sourcePath, targetPath)
    rmSync(sourcePath, { recursive: true, force: true })
    return
  }

  copyFileSync(sourcePath, targetPath)
  rmSync(sourcePath, { force: true })
}

function migrateLegacyDirToLibrary(
  legacyDir: string,
  targetDir: string,
  backupDir: string
): boolean {
  if (!existsSync(legacyDir)) {
    return false
  }
  if (existsSync(backupDir)) {
    return false
  }

  mkdirSync(targetDir, { recursive: true })
  for (const entry of readdirSync(legacyDir, { withFileTypes: true })) {
    const sourcePath = join(legacyDir, entry.name)
    const targetPath = join(targetDir, entry.name)
    if (existsSync(targetPath)) {
      continue
    }
    moveEntry(sourcePath, targetPath)
  }

  renameSync(legacyDir, backupDir)
  return true
}

export function getKiteLibraryDir(configDir: string = getConfigDir()): string {
  return resolveKiteLibraryRootFromConfigDir(configDir)
}

export function getKiteSkillsDir(configDir: string = getConfigDir()): string {
  return join(getKiteLibraryDir(configDir), 'Skills')
}

export function getKiteAgentsDir(configDir: string = getConfigDir()): string {
  return join(getKiteLibraryDir(configDir), 'Agents')
}

export function getKiteSpacesDir(configDir: string = getConfigDir()): string {
  return join(getKiteLibraryDir(configDir), 'Spaces')
}

export function ensureKiteLibraryDirs(configDir: string = getConfigDir()): void {
  const libraryDir = getKiteLibraryDir(configDir)
  const skillsDir = getKiteSkillsDir(configDir)
  const agentsDir = getKiteAgentsDir(configDir)
  const spacesDir = getKiteSpacesDir(configDir)

  for (const dir of [libraryDir, skillsDir, agentsDir, spacesDir]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }
}

export function migrateLegacyResourceDirs(configDir: string = getConfigDir()): void {
  ensureKiteLibraryDirs(configDir)

  const markerPath = getLegacyMigrationMarkerPath(configDir)
  if (existsSync(markerPath)) {
    return
  }

  const legacySkillsDir = join(configDir, 'skills')
  const legacyAgentsDir = join(configDir, 'agents')
  const legacySkillsBackupDir = join(configDir, 'skills.legacy-backup')
  const legacyAgentsBackupDir = join(configDir, 'agents.legacy-backup')

  const migratedSkills = migrateLegacyDirToLibrary(
    legacySkillsDir,
    getKiteSkillsDir(configDir),
    legacySkillsBackupDir
  )
  const migratedAgents = migrateLegacyDirToLibrary(
    legacyAgentsDir,
    getKiteAgentsDir(configDir),
    legacyAgentsBackupDir
  )

  const markerPayload = {
    schemaVersion: 1,
    migratedAt: new Date().toISOString(),
    migratedSkills,
    migratedAgents
  }
  writeFileSync(markerPath, JSON.stringify(markerPayload, null, 2), 'utf-8')
}

export function isPathInsideKiteLibrary(pathValue: string, configDir: string = getConfigDir()): boolean {
  const root = getKiteLibraryDir(configDir)
  return isPathInside(resolve(root), resolve(pathValue))
}

export function clearKiteLibraryMigrationMarkerForTest(configDir: string): void {
  const markerPath = getLegacyMigrationMarkerPath(configDir)
  if (!existsSync(markerPath)) return
  rmSync(markerPath, { force: true })
}
