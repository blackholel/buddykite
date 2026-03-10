import { afterEach, describe, expect, it } from 'vitest'
import { join, resolve } from 'path'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import {
  FS_BOUNDARY_VIOLATION,
  validatePathWithinWorkspaceBoundary
} from '../../../src/main/utils/path-validation'

describe('path-validation workspace boundary', () => {
  const createdRoots: string[] = []

  function createTempRoot(prefix: string): string {
    const root = mkdtempSync(join(tmpdir(), prefix))
    createdRoots.push(root)
    return root
  }

  afterEach(() => {
    for (const root of createdRoots.splice(0, createdRoots.length)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('允许工作区内路径（含不存在目标）', () => {
    const workspace = createTempRoot('boundary-workspace-')
    mkdirSync(join(workspace, 'src'), { recursive: true })
    writeFileSync(join(workspace, 'src', 'main.ts'), 'console.log("ok")', 'utf-8')

    const existing = validatePathWithinWorkspaceBoundary(
      join(workspace, 'src', 'main.ts'),
      workspace
    )
    const nonExisting = validatePathWithinWorkspaceBoundary(
      join(workspace, 'src', 'future.ts'),
      workspace
    )

    expect(existing.allowed).toBe(true)
    expect(nonExisting.allowed).toBe(true)
  })

  it('拒绝工作区外路径并返回 FS_BOUNDARY_VIOLATION', () => {
    const workspace = createTempRoot('boundary-workspace-')
    const outsideRoot = createTempRoot('boundary-outside-')
    const outsideFile = join(outsideRoot, 'outside.txt')
    writeFileSync(outsideFile, 'outside', 'utf-8')

    const result = validatePathWithinWorkspaceBoundary(outsideFile, workspace)
    expect(result.allowed).toBe(false)
    expect(result.errorCode).toBe(FS_BOUNDARY_VIOLATION)
  })

  it('拒绝通过符号链接逃逸工作区', () => {
    const workspace = createTempRoot('boundary-workspace-')
    const outsideRoot = createTempRoot('boundary-outside-')
    const outsideFile = join(outsideRoot, 'secret.txt')
    writeFileSync(outsideFile, 'secret', 'utf-8')

    const linkedDir = join(workspace, 'linked')
    try {
      symlinkSync(outsideRoot, linkedDir, 'dir')
    } catch {
      // 某些环境无权限创建 symlink，跳过该用例
      return
    }

    const escapedPath = resolve(linkedDir, 'secret.txt')
    const result = validatePathWithinWorkspaceBoundary(escapedPath, workspace)
    expect(result.allowed).toBe(false)
    expect(result.errorCode).toBe(FS_BOUNDARY_VIOLATION)
  })
})
