import { execFileSync } from 'child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { getSpace } from './space.service'
import { validatePathWithinWorkspaceBoundary } from '../utils/path-validation'
import { calculateLineDiffStats } from '../../shared/utils/diff-stats'

const KITE_VERSION_CONFIG_KEY = 'kite.versionControl'
const KITE_OWNER_CONFIG_KEY = 'kite.versionControlOwner'
const KITE_SPACE_CONFIG_KEY = 'kite.spaceId'
const KITE_OWNER = 'hello-halo'
const DEFAULT_LIMIT = 30
const GIT_TOOL_UNAVAILABLE = '版本管理所需的本地版本工具不可用'

const DEFAULT_GITIGNORE_LINES = [
  '# Kite app state',
  '.kite/**',
  '',
  '# Local environment',
  '.env*',
  '',
  '# Dependencies and build output',
  'node_modules/',
  'dist/',
  'build/',
  'out/',
  '.cache/',
  '.vite/',
  '',
  '# OS files',
  '.DS_Store',
]

export type VersionControlStatusKind =
  | 'disabled'
  | 'enabled'
  | 'external'
  | 'unsupported'
  | 'tool_missing'
  | 'error'

export type VersionFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked'

export interface VersionFileChange {
  path: string
  previousPath?: string
  fileName: string
  status: VersionFileStatus
  staged: boolean
  binary: boolean
  added: number
  removed: number
  beforeContent?: string
  afterContent?: string
}

export interface VersionControlStatus {
  kind: VersionControlStatusKind
  enabled: boolean
  message?: string
  changes: VersionFileChange[]
  summary: {
    totalFiles: number
    totalAdded: number
    totalRemoved: number
  }
}

export interface VersionEntry {
  id: string
  shortId: string
  message: string
  createdAt: string
  fileCount: number
}

export interface VersionDiffResult {
  versionId?: string
  files: VersionFileChange[]
  summary: VersionControlStatus['summary']
}

interface ResolvedSpace {
  id: string
  path: string
}

interface GitResult {
  stdout: Buffer
  stderr: Buffer
}

interface RawStatusEntry {
  index: string
  worktree: string
  path: string
  previousPath?: string
}

interface DiffTreeEntry {
  statusCode: string
  path: string
  previousPath?: string
}

function versionError(message: string, code?: string): Error {
  const error = new Error(message) as Error & { code?: string }
  if (code) error.code = code
  return error
}

function resolveSpace(spaceId: string): ResolvedSpace {
  const space = getSpace(spaceId)
  if (!space) throw versionError(`Space not found: ${spaceId}`, 'SPACE_NOT_FOUND')
  return { id: space.id, path: resolve(space.path) }
}

function gitDir(spacePath: string): string {
  return join(spacePath, '.git')
}

function markerPath(spacePath: string): string {
  return join(spacePath, '.kite', 'version-control.json')
}

function isGitDirSupported(spacePath: string): boolean {
  try {
    return statSync(gitDir(spacePath)).isDirectory()
  } catch {
    return false
  }
}

function validateGitStructure(spacePath: string): 'none' | 'directory' | 'unsupported' {
  const path = gitDir(spacePath)
  if (!existsSync(path)) return 'none'
  return isGitDirSupported(spacePath) ? 'directory' : 'unsupported'
}

function executableCandidates(): string[] {
  const candidates = ['git']
  if (process.platform === 'darwin') {
    candidates.push('/usr/bin/git', '/opt/homebrew/bin/git', '/usr/local/bin/git')
  }
  if (process.platform === 'win32') {
    const programFiles = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]
      .filter((value): value is string => Boolean(value))
    for (const base of programFiles) {
      candidates.push(join(base, 'Git', 'cmd', 'git.exe'))
      candidates.push(join(base, 'Programs', 'Git', 'cmd', 'git.exe'))
    }
    candidates.push('C:\\Program Files\\Git\\cmd\\git.exe', 'C:\\Program Files (x86)\\Git\\cmd\\git.exe')
  }
  return Array.from(new Set(candidates))
}

let cachedGitExecutable: string | null | undefined

export function resolveGitExecutable(): string | null {
  if (cachedGitExecutable !== undefined) return cachedGitExecutable
  for (const candidate of executableCandidates()) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' })
      cachedGitExecutable = candidate
      return candidate
    } catch {
      // Try the next platform-specific candidate.
    }
  }
  cachedGitExecutable = null
  return null
}

function requireGit(): string {
  const git = resolveGitExecutable()
  if (!git) throw versionError(GIT_TOOL_UNAVAILABLE, 'VERSION_TOOL_MISSING')
  return git
}

function runGit(spacePath: string, args: string[], options: { input?: Buffer; allowFailure?: boolean } = {}): GitResult {
  const git = requireGit()
  try {
    const stdout = execFileSync(git, args, {
      cwd: spacePath,
      input: options.input,
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as Buffer
    return { stdout, stderr: Buffer.alloc(0) }
  } catch (error) {
    const err = error as Error & { stdout?: Buffer; stderr?: Buffer; status?: number }
    if (options.allowFailure) {
      return { stdout: err.stdout || Buffer.alloc(0), stderr: err.stderr || Buffer.from(err.message) }
    }
    const message = (err.stderr?.toString('utf-8') || err.message || 'Version command failed').trim()
    throw versionError(message, 'VERSION_COMMAND_FAILED')
  }
}

function readLocalConfig(spacePath: string, key: string): string | null {
  try {
    return runGit(spacePath, ['config', '--local', '--get', key]).stdout.toString('utf-8').trim() || null
  } catch {
    return null
  }
}

function isKiteManagedRepo(space: ResolvedSpace): boolean {
  if (validateGitStructure(space.path) !== 'directory') return false
  const enabled = readLocalConfig(space.path, KITE_VERSION_CONFIG_KEY)
  const owner = readLocalConfig(space.path, KITE_OWNER_CONFIG_KEY)
  const spaceId = readLocalConfig(space.path, KITE_SPACE_CONFIG_KEY)
  return enabled === 'true' && owner === KITE_OWNER && spaceId === space.id
}

function requireManagedSpace(spaceId: string): ResolvedSpace {
  const space = resolveSpace(spaceId)
  const structure = validateGitStructure(space.path)
  if (structure === 'none') throw versionError('当前工作区尚未开启版本管理', 'VERSION_DISABLED')
  if (structure === 'unsupported') throw versionError('当前工作区版本结构暂不支持', 'VERSION_UNSUPPORTED')
  requireGit()
  if (!isKiteManagedRepo(space)) {
    throw versionError('当前工作区已有外部版本结构，暂不由 Kite 接管。', 'EXTERNAL_VERSION_STRUCTURE')
  }
  return space
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/')
}

function resolveRelativePath(space: ResolvedSpace, filePath: string): string {
  const absolutePath = isAbsolute(filePath) ? resolve(filePath) : resolve(space.path, filePath)
  const validation = validatePathWithinWorkspaceBoundary(absolutePath, space.path)
  if (!validation.allowed) {
    throw versionError('文件不在当前工作区内', 'VERSION_PATH_OUTSIDE_SPACE')
  }
  const rel = normalizeRelativePath(relative(space.path, validation.resolvedPath))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw versionError('文件不在当前工作区内', 'VERSION_PATH_OUTSIDE_SPACE')
  }
  return rel
}

function shouldExcludePath(relativePath: string): boolean {
  const rel = normalizeRelativePath(relativePath)
  const name = basename(rel)
  return (
    rel === '.git' || rel.startsWith('.git/') ||
    rel === '.kite' || rel.startsWith('.kite/') ||
    rel === 'node_modules' || rel.startsWith('node_modules/') ||
    rel === 'dist' || rel.startsWith('dist/') ||
    rel === 'build' || rel.startsWith('build/') ||
    rel === 'out' || rel.startsWith('out/') ||
    rel === '.cache' || rel.startsWith('.cache/') ||
    rel === '.vite' || rel.startsWith('.vite/') ||
    name === '.DS_Store' ||
    name.startsWith('.env')
  )
}

function ensureGitignore(spacePath: string): void {
  const file = join(spacePath, '.gitignore')
  const existing = existsSync(file) ? readFileSync(file, 'utf-8') : ''
  const lines = existing.split(/\r?\n/)
  const missing = DEFAULT_GITIGNORE_LINES.filter((line) => line === '' || !lines.includes(line))
  if (missing.length === 0) return
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : ''
  writeFileSync(file, `${existing}${prefix}${missing.join('\n')}\n`, 'utf-8')
}

function writeMarker(space: ResolvedSpace): void {
  const dir = dirname(markerPath(space.path))
  mkdirSync(dir, { recursive: true })
  writeFileSync(markerPath(space.path), JSON.stringify({
    version: 1,
    owner: KITE_OWNER,
    spaceId: space.id,
    createdAt: new Date().toISOString(),
  }, null, 2), 'utf-8')
}

function configureManagedRepo(space: ResolvedSpace): void {
  runGit(space.path, ['config', '--local', KITE_VERSION_CONFIG_KEY, 'true'])
  runGit(space.path, ['config', '--local', KITE_OWNER_CONFIG_KEY, KITE_OWNER])
  runGit(space.path, ['config', '--local', KITE_SPACE_CONFIG_KEY, space.id])
}

function splitNulOutput(output: Buffer): string[] {
  return output.toString('utf-8').split('\0').filter(Boolean)
}

function parsePorcelain(output: Buffer): RawStatusEntry[] {
  const parts = splitNulOutput(output)
  const entries: RawStatusEntry[] = []
  for (let i = 0; i < parts.length; i += 1) {
    const item = parts[i]
    if (item.length < 4) continue
    const index = item[0]
    const worktree = item[1]
    const rest = item.slice(3)
    if (index === 'R' || index === 'C') {
      const next = parts[i + 1]
      entries.push({ index, worktree, path: normalizeRelativePath(rest), previousPath: next ? normalizeRelativePath(next) : undefined })
      i += 1
    } else {
      entries.push({ index, worktree, path: normalizeRelativePath(rest) })
    }
  }
  return entries
}

function parseDiffTreeNameStatus(output: Buffer): DiffTreeEntry[] {
  const parts = splitNulOutput(output)
  const entries: DiffTreeEntry[] = []
  for (let i = 0; i < parts.length;) {
    const statusCode = parts[i++]
    if (!statusCode) continue
    if (statusCode.startsWith('R') || statusCode.startsWith('C')) {
      const previousPath = parts[i++]
      const path = parts[i++]
      if (path) entries.push({
        statusCode,
        path: normalizeRelativePath(path),
        previousPath: previousPath ? normalizeRelativePath(previousPath) : undefined,
      })
      continue
    }
    const path = parts[i++]
    if (path) entries.push({ statusCode, path: normalizeRelativePath(path) })
  }
  return entries
}

function gitStatusEntries(spacePath: string): RawStatusEntry[] {
  return parsePorcelain(runGit(spacePath, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout)
}

function isStagedEntry(entry: RawStatusEntry): boolean {
  return entry.index !== ' ' && entry.index !== '?'
}

function isExcludedEntry(entry: RawStatusEntry): boolean {
  return shouldExcludePath(entry.path) || Boolean(entry.previousPath && shouldExcludePath(entry.previousPath))
}

function isBinaryBuffer(buffer: Buffer): boolean {
  const limit = Math.min(buffer.length, 8000)
  for (let i = 0; i < limit; i += 1) {
    if (buffer[i] === 0) return true
  }
  return false
}

function readWorktreeFile(spacePath: string, rel: string): Buffer | null {
  const absolutePath = resolve(spacePath, rel)
  if (!existsSync(absolutePath)) return null
  try {
    const stat = statSync(absolutePath)
    if (!stat.isFile()) return null
    return readFileSync(absolutePath)
  } catch {
    return null
  }
}

function readVersionFile(spacePath: string, versionId: string, rel: string): Buffer | null {
  const result = runGit(spacePath, ['show', `${versionId}:${rel}`], { allowFailure: true })
  if (result.stderr.length > 0 && result.stdout.length === 0) return null
  return result.stdout
}

function safeText(buffer: Buffer | null): string | undefined {
  if (!buffer || isBinaryBuffer(buffer)) return undefined
  return buffer.toString('utf-8')
}

function summarizeBuffers(before: Buffer | null, after: Buffer | null, rel?: string): { binary: boolean; added: number; removed: number; beforeContent?: string; afterContent?: string } {
  const binary = Boolean((before && isBinaryBuffer(before)) || (after && isBinaryBuffer(after)))
  if (binary) return { binary, added: 0, removed: 0 }
  const beforeContent = safeText(before) || ''
  const afterContent = safeText(after) || ''
  const stats = calculateLineDiffStats(beforeContent, afterContent, { filePath: rel })
  return { binary, added: stats.added, removed: stats.removed, beforeContent, afterContent }
}

function statusFromEntry(entry: RawStatusEntry): VersionFileStatus {
  if (entry.index === '?' && entry.worktree === '?') return 'untracked'
  if (entry.index === 'R' || entry.worktree === 'R') return 'renamed'
  if (entry.index === 'D' || entry.worktree === 'D') return 'deleted'
  if (entry.index === 'A' || entry.worktree === 'A') return 'added'
  return 'modified'
}

function toVersionFileChange(spacePath: string, entry: RawStatusEntry): VersionFileChange | null {
  const rel = entry.path
  if (shouldExcludePath(rel)) return null
  const status = statusFromEntry(entry)
  const beforeRel = entry.previousPath || rel
  const before = status === 'untracked' || status === 'added'
    ? null
    : readVersionFile(spacePath, 'HEAD', beforeRel)
  const after = status === 'deleted' ? null : readWorktreeFile(spacePath, rel)
  const summary = summarizeBuffers(before, after, rel)
  return {
    path: rel,
    previousPath: entry.previousPath,
    fileName: basename(rel),
    status,
    staged: entry.index !== ' ' && entry.index !== '?',
    ...summary,
  }
}

function buildSummary(files: VersionFileChange[]): VersionControlStatus['summary'] {
  return files.reduce((acc, file) => {
    acc.totalFiles += 1
    acc.totalAdded += file.added
    acc.totalRemoved += file.removed
    return acc
  }, { totalFiles: 0, totalAdded: 0, totalRemoved: 0 })
}

function currentDiff(space: ResolvedSpace): VersionDiffResult {
  const files = gitStatusEntries(space.path)
    .map((entry) => toVersionFileChange(space.path, entry))
    .filter((file): file is VersionFileChange => Boolean(file))
  return { files, summary: buildSummary(files) }
}

function stageAllowedChanges(space: ResolvedSpace): VersionFileChange[] {
  const entries = gitStatusEntries(space.path)
  const stagedEntries = entries.filter(isStagedEntry)
  const stagedExternalEntries = stagedEntries.filter((entry) => !isExcludedEntry(entry))
  if (stagedExternalEntries.length > 0) {
    throw versionError('检测到外部暂存内容，请先在外部版本工具中处理后再保存版本。', 'VERSION_STAGED_CHANGES_PRESENT')
  }
  const stagedExcludedEntries = stagedEntries.filter(isExcludedEntry)
  for (const entry of stagedExcludedEntries) {
    if (entry.previousPath) runGit(space.path, ['reset', '-q', '--', entry.previousPath])
    runGit(space.path, ['reset', '-q', '--', entry.path])
  }

  const effectiveEntries = stagedExcludedEntries.length > 0 ? gitStatusEntries(space.path) : entries
  const allowed = effectiveEntries.filter((entry) => !isExcludedEntry(entry))
  for (const entry of allowed) {
    if (entry.previousPath) runGit(space.path, ['add', '--', entry.previousPath])
    runGit(space.path, ['add', '--', entry.path])
  }
  return allowed
    .map((entry) => toVersionFileChange(space.path, entry))
    .filter((file): file is VersionFileChange => Boolean(file))
}

function commit(space: ResolvedSpace, message: string, allowEmpty = false): void {
  const args = [
    '-c', 'user.name=Kite',
    '-c', 'user.email=kite@local',
    'commit',
  ]
  if (allowEmpty) args.push('--allow-empty')
  args.push('-m', message)
  runGit(space.path, args)
}

function ensureCommitId(spacePath: string, versionId: string): void {
  if (!/^[0-9a-f]{7,40}$/i.test(versionId)) {
    throw versionError('版本标识无效', 'VERSION_ID_INVALID')
  }
  const result = runGit(spacePath, ['cat-file', '-e', `${versionId}^{commit}`], { allowFailure: true })
  if (result.stderr.length > 0) throw versionError('版本不存在', 'VERSION_NOT_FOUND')
}

function fileExistsInVersion(spacePath: string, versionId: string, rel: string): boolean {
  const result = runGit(spacePath, ['cat-file', '-e', `${versionId}:${rel}`], { allowFailure: true })
  return result.stderr.length === 0
}

function ensureParentDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
}

function removeFileIfExists(path: string): void {
  if (existsSync(path)) rmSync(path, { force: true })
}

export function getVersionControlStatus(spaceId: string): VersionControlStatus {
  const space = resolveSpace(spaceId)
  if (!resolveGitExecutable()) {
    return { kind: 'tool_missing', enabled: false, message: GIT_TOOL_UNAVAILABLE, changes: [], summary: buildSummary([]) }
  }
  const structure = validateGitStructure(space.path)
  if (structure === 'none') {
    return { kind: 'disabled', enabled: false, changes: [], summary: buildSummary([]) }
  }
  if (structure === 'unsupported') {
    return { kind: 'unsupported', enabled: false, message: '当前工作区版本结构暂不支持', changes: [], summary: buildSummary([]) }
  }
  try {
    requireGit()
    if (!isKiteManagedRepo(space)) {
      return { kind: 'external', enabled: false, message: '当前工作区已有外部版本结构，暂不由 Kite 接管。', changes: [], summary: buildSummary([]) }
    }
    const diff = currentDiff(space)
    return { kind: 'enabled', enabled: true, changes: diff.files, summary: diff.summary }
  } catch (error) {
    const err = error as Error & { code?: string }
    if (err.code === 'VERSION_TOOL_MISSING') {
      return { kind: 'tool_missing', enabled: false, message: GIT_TOOL_UNAVAILABLE, changes: [], summary: buildSummary([]) }
    }
    return { kind: 'error', enabled: false, message: err.message, changes: [], summary: buildSummary([]) }
  }
}

export function initVersionControl(spaceId: string): VersionControlStatus {
  const space = resolveSpace(spaceId)
  const structure = validateGitStructure(space.path)
  if (structure === 'unsupported') throw versionError('当前工作区版本结构暂不支持', 'VERSION_UNSUPPORTED')
  requireGit()
  if (structure === 'directory' && !isKiteManagedRepo(space)) {
    throw versionError('当前工作区已有外部版本结构，暂不由 Kite 接管。', 'EXTERNAL_VERSION_STRUCTURE')
  }
  if (structure === 'none') {
    runGit(space.path, ['init'])
    configureManagedRepo(space)
    writeMarker(space)
    ensureGitignore(space.path)
    stageAllowedChanges(space)
    commit(space, '初始化工作区', true)
  } else {
    ensureGitignore(space.path)
    writeMarker(space)
  }
  return getVersionControlStatus(spaceId)
}

export function createVersion(spaceId: string, message: string): VersionEntry | null {
  const trimmed = message.trim()
  if (!trimmed) throw versionError('版本说明不能为空', 'VERSION_MESSAGE_REQUIRED')
  const space = requireManagedSpace(spaceId)
  const stagedFiles = stageAllowedChanges(space)
  if (stagedFiles.length === 0) return null
  commit(space, trimmed)
  return listVersions(spaceId, 1)[0] || null
}

export function listVersions(spaceId: string, limit = DEFAULT_LIMIT): VersionEntry[] {
  const space = requireManagedSpace(spaceId)
  const count = Math.max(1, Math.min(100, limit || DEFAULT_LIMIT))
  const output = runGit(space.path, ['log', `-${count}`, '--format=%H%x00%h%x00%aI%x00%s%x1e'], { allowFailure: true }).stdout.toString('utf-8')
  return output.split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [id, shortId, createdAt, message] = record.split('\0')
      const filesOutput = runGit(space.path, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', id], { allowFailure: true }).stdout
      const fileCount = splitNulOutput(filesOutput).map(normalizeRelativePath).filter((line) => line && !shouldExcludePath(line)).length
      return { id, shortId, createdAt, message, fileCount }
    })
}

export function getVersionDiff(spaceId: string, options: { versionId?: string } = {}): VersionDiffResult {
  const space = requireManagedSpace(spaceId)
  if (!options.versionId) return currentDiff(space)
  ensureCommitId(space.path, options.versionId)
  const output = runGit(space.path, ['diff-tree', '--root', '--no-commit-id', '--name-status', '-r', '-M', '-z', options.versionId], { allowFailure: true }).stdout
  const files = parseDiffTreeNameStatus(output).map(({ statusCode, path: rel, previousPath: prev }) => {
    if (!rel || shouldExcludePath(rel)) return null
    const before = statusCode.startsWith('A') ? null : readVersionFile(space.path, `${options.versionId}^`, prev || rel)
    const after = statusCode.startsWith('D') ? null : readVersionFile(space.path, options.versionId as string, rel)
    const summary = summarizeBuffers(before, after, rel)
    const status: VersionFileStatus = statusCode.startsWith('A') ? 'added' : statusCode.startsWith('D') ? 'deleted' : statusCode.startsWith('R') ? 'renamed' : 'modified'
    return {
      path: rel,
      previousPath: prev,
      fileName: basename(rel),
      status,
      staged: false,
      ...summary,
    } satisfies VersionFileChange
  }).filter((file): file is VersionFileChange => Boolean(file))
  return { versionId: options.versionId, files, summary: buildSummary(files) }
}

export function restoreVersionFile(spaceId: string, filePath: string, versionId: string): VersionFileChange | null {
  const space = requireManagedSpace(spaceId)
  const rel = resolveRelativePath(space, filePath)
  if (shouldExcludePath(rel)) throw versionError('该文件不允许纳入版本管理', 'VERSION_PATH_EXCLUDED')
  ensureCommitId(space.path, versionId)
  const absolutePath = resolve(space.path, rel)
  const before = readWorktreeFile(space.path, rel)
  if (fileExistsInVersion(space.path, versionId, rel)) {
    const content = runGit(space.path, ['show', `${versionId}:${rel}`]).stdout
    ensureParentDir(absolutePath)
    writeFileSync(absolutePath, content)
  } else {
    removeFileIfExists(absolutePath)
  }
  const after = readWorktreeFile(space.path, rel)
  const summary = summarizeBuffers(before, after, rel)
  return {
    path: rel,
    fileName: basename(rel),
    status: after ? 'modified' : 'deleted',
    staged: false,
    ...summary,
  }
}

export function discardVersionFile(spaceId: string, filePath: string): VersionFileChange | null {
  const space = requireManagedSpace(spaceId)
  const rel = resolveRelativePath(space, filePath)
  if (shouldExcludePath(rel)) throw versionError('该文件不允许纳入版本管理', 'VERSION_PATH_EXCLUDED')
  const absolutePath = resolve(space.path, rel)
  const before = readWorktreeFile(space.path, rel)
  if (fileExistsInVersion(space.path, 'HEAD', rel)) {
    const content = runGit(space.path, ['show', `HEAD:${rel}`]).stdout
    ensureParentDir(absolutePath)
    writeFileSync(absolutePath, content)
  } else {
    removeFileIfExists(absolutePath)
  }
  const after = readWorktreeFile(space.path, rel)
  const summary = summarizeBuffers(before, after, rel)
  return {
    path: rel,
    fileName: basename(rel),
    status: after ? 'modified' : 'deleted',
    staged: false,
    ...summary,
  }
}
