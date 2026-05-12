import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const spaces = vi.hoisted(() => new Map<string, { id: string; path: string }>())

vi.mock('../../../src/main/services/space.service', () => ({
  getSpace: vi.fn((spaceId: string) => spaces.get(spaceId) || null),
}))

import {
  createVersion,
  getVersionDiff,
  getVersionControlStatus,
  initVersionControl,
  listVersions,
  resolveGitExecutable,
} from '../../../src/main/services/version-control.service'

const git = resolveGitExecutable()
const tempRoots: string[] = []

function createTempSpace(id: string): string {
  const dir = mkdtempSync(join(tmpdir(), `kite-version-${id}-`))
  tempRoots.push(dir)
  spaces.set(id, { id, path: dir })
  return dir
}

function runGit(dir: string, args: string[]): string {
  if (!git) throw new Error('git unavailable')
  return execFileSync(git, args, {
    cwd: dir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function runGitRaw(dir: string, args: string[]): string {
  if (!git) throw new Error('git unavailable')
  return execFileSync(git, args, {
    cwd: dir,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

describe('version-control.service', () => {
  beforeEach(() => {
    spaces.clear()
  })

  afterEach(() => {
    for (const dir of tempRoots.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does not take over an existing unmarked repository', () => {
    if (!git) return
    const dir = createTempSpace('external')
    runGit(dir, ['init'])

    const status = getVersionControlStatus('external')

    expect(status.kind).toBe('external')
    expect(status.enabled).toBe(false)
    expect(status.message).toContain('外部版本结构')
  })

  it('initializes a managed repository and excludes app state and local secrets', () => {
    if (!git) return
    const dir = createTempSpace('managed')
    writeFileSync(join(dir, 'README.md'), '# Hello\n', 'utf-8')
    writeFileSync(join(dir, '.env'), 'TOKEN=secret\n', 'utf-8')
    writeFileSync(join(dir, '.envrc'), 'dotenv\n', 'utf-8')
    mkdirSync(join(dir, '.kite', 'conversations'), { recursive: true })
    mkdirSync(join(dir, '.kite', 'change-sets'), { recursive: true })
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(dir, '.kite', 'conversations', 'one.json'), '{}', 'utf-8')
    writeFileSync(join(dir, '.kite', 'change-sets', 'one.json'), '{}', 'utf-8')
    writeFileSync(join(dir, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1\n', 'utf-8')

    const status = initVersionControl('managed')
    const tracked = runGit(dir, ['ls-tree', '-r', '--name-only', 'HEAD']).split(/\r?\n/)

    expect(status.kind).toBe('enabled')
    expect(runGit(dir, ['config', '--local', '--get', 'kite.versionControl'])).toBe('true')
    expect(existsSync(join(dir, '.kite', 'version-control.json'))).toBe(true)
    expect(readFileSync(join(dir, '.gitignore'), 'utf-8')).toContain('.kite/**')
    expect(tracked).toContain('README.md')
    expect(tracked).toContain('.gitignore')
    expect(tracked).not.toContain('.env')
    expect(tracked).not.toContain('.envrc')
    expect(tracked.some((path) => path.startsWith('.kite/'))).toBe(false)
    expect(tracked.some((path) => path.startsWith('node_modules/'))).toBe(false)
  })

  it('filters tracked app state from status and save operations', () => {
    if (!git) return
    const dir = createTempSpace('tracked-internal')
    writeFileSync(join(dir, 'note.md'), 'one\n', 'utf-8')
    initVersionControl('tracked-internal')

    mkdirSync(join(dir, '.kite', 'conversations'), { recursive: true })
    writeFileSync(join(dir, '.kite', 'conversations', 'tracked.json'), 'old\n', 'utf-8')
    runGit(dir, ['add', '-f', '.kite/conversations/tracked.json'])
    runGit(dir, ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-m', 'force internal'])
    writeFileSync(join(dir, '.kite', 'conversations', 'tracked.json'), 'new\n', 'utf-8')
    runGit(dir, ['add', '-f', '.kite/conversations/tracked.json'])

    const status = getVersionControlStatus('tracked-internal')
    const created = createVersion('tracked-internal', '保存外部可见内容')
    const porcelain = runGitRaw(dir, ['status', '--porcelain=v1', '-z'])

    expect(status.summary.totalFiles).toBe(0)
    expect(created).toBeNull()
    expect(porcelain).toContain(' M .kite/conversations/tracked.json')
    expect(porcelain).not.toContain('M  .kite/conversations/tracked.json')
  })

  it('restores text and binary files without staging them', async () => {
    if (!git) return
    const dir = createTempSpace('restore')
    const { discardVersionFile, restoreVersionFile, listVersions } = await import('../../../src/main/services/version-control.service')
    writeFileSync(join(dir, 'note.md'), 'before\n', 'utf-8')
    writeFileSync(join(dir, 'image.bin'), Buffer.from([0, 1, 2, 3]))
    initVersionControl('restore')

    writeFileSync(join(dir, 'note.md'), 'after\n', 'utf-8')
    writeFileSync(join(dir, 'image.bin'), Buffer.from([0, 9, 9, 3]))
    createVersion('restore', '修改内容')
    const version = listVersions('restore', 2)[1]

    writeFileSync(join(dir, 'note.md'), 'worktree\n', 'utf-8')
    restoreVersionFile('restore', 'note.md', version.id)
    discardVersionFile('restore', 'image.bin')
    const porcelain = runGitRaw(dir, ['status', '--porcelain=v1', '-z'])

    expect(readFileSync(join(dir, 'note.md'), 'utf-8')).toBe('before\n')
    expect(Array.from(readFileSync(join(dir, 'image.bin')))).toEqual([0, 9, 9, 3])
    expect(porcelain).toContain(' M note.md')
    expect(porcelain).not.toContain('M  note.md')
    expect(porcelain).not.toContain('M  image.bin')
  })

  it('shows historical changes for unicode file paths', () => {
    if (!git) return
    const dir = createTempSpace('unicode-history')
    writeFileSync(join(dir, 'README.md'), '# Base\n', 'utf-8')
    initVersionControl('unicode-history')

    writeFileSync(join(dir, '学习指南.md'), '第一行\n第二行\n', 'utf-8')
    createVersion('unicode-history', '增加学习指南')
    const [version] = listVersions('unicode-history', 1)
    const diff = getVersionDiff('unicode-history', { versionId: version.id })

    expect(version.fileCount).toBe(1)
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0]).toMatchObject({
      path: '学习指南.md',
      fileName: '学习指南.md',
      status: 'added',
      binary: false,
      added: 2,
      removed: 0,
      beforeContent: '',
      afterContent: '第一行\n第二行\n',
    })
  })

  it('counts widget exports by embedded widget code lines in workspace status', () => {
    if (!git) return
    const dir = createTempSpace('widget-lines')
    writeFileSync(join(dir, 'README.md'), '# Base\n', 'utf-8')
    initVersionControl('widget-lines')

    mkdirSync(join(dir, 'widgets'), { recursive: true })
    const markdown = [
      '# Widget',
      '',
      '```show-widget',
      JSON.stringify({
        title: 'Widget',
        widget_code: '<div><section><h1>标题</h1><p>正文</p></section><style>.card{color:red;display:flex;}</style></div>'
      }),
      '```',
      ''
    ].join('\n')
    writeFileSync(join(dir, 'widgets', 'widget.md'), markdown, 'utf-8')

    const status = getVersionControlStatus('widget-lines')
    const widgetFile = status.changes.find((file) => file.path === 'widgets/widget.md')

    expect(widgetFile?.added).toBe(11)
    expect(status.summary.totalAdded).toBe(11)
  })
})
