import { basename, extname, join, resolve } from 'path'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { getLockedUserConfigRootDir } from './config-source-mode.service'
import { getKiteAgentsDir, getKiteSkillsDir } from './kite-library.service'
import {
  buildResourceLibraryStateKey,
  setResourceEnabledState,
} from './resource-library-state.service'

export interface ResourceImportOptions {
  overwrite?: boolean
}

export type ResourceImportResult =
  | {
    status: 'imported'
    name: string
    path: string
  }
  | {
    status: 'conflict'
    existingPath: string
  }

function ensureDirectory(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
}

function ensureSkillSourceDirectory(sourcePath: string): void {
  if (!existsSync(sourcePath) || !statSync(sourcePath).isDirectory()) {
    throw new Error('Skill import source must be a directory')
  }
  const skillMdPath = join(sourcePath, 'SKILL.md')
  if (!existsSync(skillMdPath) || !statSync(skillMdPath).isFile()) {
    throw new Error('Skill directory must contain SKILL.md')
  }
}

function ensureAgentSourceFile(sourcePath: string): void {
  if (extname(sourcePath).toLowerCase() !== '.md') {
    throw new Error('Agent import source must be a markdown file')
  }
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    throw new Error('Agent import source must be a markdown file')
  }
}

function copyDirectory(sourcePath: string, targetPath: string): void {
  cpSync(sourcePath, targetPath, {
    recursive: true,
    force: true,
    errorOnExist: false
  })
}

function copyFile(sourcePath: string, targetPath: string): void {
  writeFileSync(targetPath, readFileSync(sourcePath))
}

function isSamePath(pathA: string, pathB: string): boolean {
  const resolvedA = resolve(pathA)
  const resolvedB = resolve(pathB)
  if (process.platform === 'win32') {
    return resolvedA.toLowerCase() === resolvedB.toLowerCase()
  }
  return resolvedA === resolvedB
}

export function importSkillDirectory(
  sourcePath: string,
  options?: ResourceImportOptions
): ResourceImportResult {
  ensureSkillSourceDirectory(sourcePath)

  const configRoot = getLockedUserConfigRootDir()
  const skillsDir = getKiteSkillsDir(configRoot)
  const skillName = basename(sourcePath)
  const targetPath = join(skillsDir, skillName)

  ensureDirectory(skillsDir)

  if (existsSync(targetPath) && !options?.overwrite) {
    return { status: 'conflict', existingPath: targetPath }
  }

  if (existsSync(targetPath) && options?.overwrite && !isSamePath(sourcePath, targetPath)) {
    rmSync(targetPath, { recursive: true, force: true })
  }

  if (!isSamePath(sourcePath, targetPath)) {
    copyDirectory(sourcePath, targetPath)
  }
  setResourceEnabledState(
    buildResourceLibraryStateKey('skill', 'app', skillName),
    true,
    configRoot
  )

  return {
    status: 'imported',
    name: skillName,
    path: targetPath
  }
}

export function importAgentFile(
  sourcePath: string,
  options?: ResourceImportOptions
): ResourceImportResult {
  ensureAgentSourceFile(sourcePath)

  const configRoot = getLockedUserConfigRootDir()
  const agentsDir = getKiteAgentsDir(configRoot)
  const agentFileName = basename(sourcePath)
  const agentName = agentFileName.replace(/\.md$/i, '')
  const targetPath = join(agentsDir, agentFileName)

  ensureDirectory(agentsDir)

  if (existsSync(targetPath) && !options?.overwrite) {
    return { status: 'conflict', existingPath: targetPath }
  }

  if (existsSync(targetPath) && options?.overwrite && !isSamePath(sourcePath, targetPath)) {
    rmSync(targetPath, { force: true })
  }

  if (!isSamePath(sourcePath, targetPath)) {
    copyFile(sourcePath, targetPath)
  }
  setResourceEnabledState(
    buildResourceLibraryStateKey('agent', 'app', agentName),
    true,
    configRoot
  )

  return {
    status: 'imported',
    name: agentName,
    path: targetPath
  }
}
