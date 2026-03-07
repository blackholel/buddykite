import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import {
  extractPackageLockVersion,
  extractPnpmImporterVersion,
  evaluateDependencyConsistency,
  runDependencyConsistencySelfCheck
} from '../../../src/main/services/dependency-consistency.service'

describe('dependency-consistency.service', () => {
  it('extracts direct dependency versions from package-lock', () => {
    const packageLock = {
      packages: {
        'node_modules/@anthropic-ai/claude-code': { version: '2.1.22' },
        'node_modules/@anthropic-ai/sdk': { version: '0.71.2' }
      }
    }

    expect(extractPackageLockVersion(packageLock, '@anthropic-ai/claude-code')).toBe('2.1.22')
    expect(extractPackageLockVersion(packageLock, '@anthropic-ai/sdk')).toBe('0.71.2')
    expect(extractPackageLockVersion(packageLock, '@anthropic-ai/claude-agent-sdk')).toBeNull()
  })

  it('extracts direct dependency versions from pnpm-lock importer block', () => {
    const pnpmLock = `
importers:
  .:
    dependencies:
      '@anthropic-ai/claude-code':
        specifier: latest
        version: 2.1.63
      '@anthropic-ai/sdk':
        specifier: latest
        version: 0.78.0
      '@anthropic-ai/claude-agent-sdk':
        specifier: 0.2.22
        version: 0.2.22(zod@4.3.6)
`

    expect(extractPnpmImporterVersion(pnpmLock, '@anthropic-ai/claude-code')).toBe('2.1.63')
    expect(extractPnpmImporterVersion(pnpmLock, '@anthropic-ai/sdk')).toBe('0.78.0')
    expect(extractPnpmImporterVersion(pnpmLock, '@anthropic-ai/claude-agent-sdk')).toBe('0.2.22')
  })

  it('reports lockfile divergence and installed-version mismatch warnings', () => {
    const result = evaluateDependencyConsistency({
      hasPackageLock: true,
      hasPnpmLock: true,
      packageLockJson: {
        packages: {
          'node_modules/@anthropic-ai/claude-code': { version: '2.1.7' },
          'node_modules/@anthropic-ai/sdk': { version: '0.71.0' },
          'node_modules/@anthropic-ai/claude-agent-sdk': { version: '0.2.22' }
        }
      },
      pnpmLockText: `
importers:
  .:
    dependencies:
      '@anthropic-ai/claude-code':
        specifier: latest
        version: 2.1.63
      '@anthropic-ai/sdk':
        specifier: latest
        version: 0.78.0
      '@anthropic-ai/claude-agent-sdk':
        specifier: 0.2.22
        version: 0.2.22
`,
      installedVersions: {
        '@anthropic-ai/claude-code': '2.1.22',
        '@anthropic-ai/sdk': '0.71.2',
        '@anthropic-ai/claude-agent-sdk': '0.2.22'
      }
    })

    expect(result.hasIssues).toBe(true)
    expect(result.warnings.some((warning) => warning.code === 'lockfile_divergence')).toBe(true)
    expect(
      result.warnings.some(
        (warning) =>
          warning.code === 'installed_mismatch' &&
          warning.packageName === '@anthropic-ai/claude-code' &&
          warning.lockSource === 'package-lock.json'
      )
    ).toBe(true)
    expect(
      result.warnings.some(
        (warning) =>
          warning.code === 'installed_mismatch' &&
          warning.packageName === '@anthropic-ai/sdk' &&
          warning.lockSource === 'pnpm-lock.yaml'
      )
    ).toBe(true)
  })

  it('emits warning log when startup self-check detects mismatches', () => {
    const root = mkdtempSync(join(tmpdir(), 'dep-self-check-warn-'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'tmp', version: '1.0.0' }))
      writeFileSync(
        join(root, 'package-lock.json'),
        JSON.stringify({
          packages: {
            'node_modules/@anthropic-ai/claude-code': { version: '2.1.7' }
          }
        })
      )
      writeFileSync(
        join(root, 'pnpm-lock.yaml'),
        `importers:
  .:
    dependencies:
      '@anthropic-ai/claude-code':
        specifier: latest
        version: 2.1.63
`
      )

      const pkgDir = join(root, 'node_modules', '@anthropic-ai', 'claude-code')
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ version: '2.1.22' }))

      const report = runDependencyConsistencySelfCheck(root)
      expect(report?.hasIssues).toBe(true)
      expect(warnSpy).toHaveBeenCalled()
      expect(String(warnSpy.mock.calls[0]?.[0] || '')).toContain('dependency_self_check_warning')
    } finally {
      warnSpy.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('passes startup self-check silently when versions are consistent', () => {
    const root = mkdtempSync(join(tmpdir(), 'dep-self-check-ok-'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'tmp', version: '1.0.0' }))
      writeFileSync(
        join(root, 'package-lock.json'),
        JSON.stringify({
          packages: {
            'node_modules/@anthropic-ai/claude-code': { version: '2.1.63' }
          }
        })
      )
      writeFileSync(
        join(root, 'pnpm-lock.yaml'),
        `importers:
  .:
    dependencies:
      '@anthropic-ai/claude-code':
        specifier: latest
        version: 2.1.63
`
      )

      const pkgDir = join(root, 'node_modules', '@anthropic-ai', 'claude-code')
      mkdirSync(pkgDir, { recursive: true })
      writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ version: '2.1.63' }))

      const report = runDependencyConsistencySelfCheck(root)
      expect(report?.hasIssues).toBe(false)
      expect(warnSpy).not.toHaveBeenCalled()
      expect(logSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
      logSpy.mockRestore()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
