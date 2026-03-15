import { beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

import { initializeApp } from '../../../src/main/services/config.service'
import { createSpace } from '../../../src/main/services/space.service'
import { createArtifactEntry, listArtifactsTree } from '../../../src/main/services/artifact.service'

describe('artifact service createArtifactEntry', () => {
  beforeEach(async () => {
    await initializeApp()
  })

  it('可以创建任意扩展名文件', async () => {
    const space = await createSpace({
      name: 'Artifact Entry File',
      icon: 'folder'
    })

    const result = await createArtifactEntry({
      type: 'file',
      parentPath: space.path,
      name: '.env.local'
    })

    expect(result.success).toBe(true)
    expect(result.data?.path).toBe(path.join(space.path, '.env.local'))
    expect(fs.existsSync(path.join(space.path, '.env.local'))).toBe(true)
  })

  it('可以创建文件夹', async () => {
    const space = await createSpace({
      name: 'Artifact Entry Folder',
      icon: 'folder'
    })

    const result = await createArtifactEntry({
      type: 'folder',
      parentPath: space.path,
      name: 'docs'
    })

    expect(result.success).toBe(true)
    expect(result.data?.path).toBe(path.join(space.path, 'docs'))
    expect(fs.existsSync(path.join(space.path, 'docs'))).toBe(true)
    expect(fs.statSync(path.join(space.path, 'docs')).isDirectory()).toBe(true)
  })

  it('树视图会显示隐藏文件但忽略隐藏目录', async () => {
    const space = await createSpace({
      name: 'Artifact Entry Hidden',
      icon: 'folder'
    })

    fs.writeFileSync(path.join(space.path, '.env.local'), '')
    fs.mkdirSync(path.join(space.path, '.cache'), { recursive: true })
    fs.writeFileSync(path.join(space.path, '.cache', 'inside.txt'), 'x')

    const tree = listArtifactsTree(space.id)
    const names = tree.map(node => node.name)

    expect(names).toContain('.env.local')
    expect(names).not.toContain('.cache')
  })

  it('拒绝包含路径分隔符的名称', async () => {
    const space = await createSpace({
      name: 'Artifact Entry Invalid Name',
      icon: 'folder'
    })

    const result = await createArtifactEntry({
      type: 'file',
      parentPath: space.path,
      name: 'nested/bad.md'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('separators')
  })

  it('拒绝越权目录创建', async () => {
    const outsidePath = path.join(os.tmpdir(), `kite-outside-${Date.now()}`)
    fs.mkdirSync(outsidePath, { recursive: true })

    const result = await createArtifactEntry({
      type: 'file',
      parentPath: outsidePath,
      name: 'escape.md'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('allowed space')
  })
})
