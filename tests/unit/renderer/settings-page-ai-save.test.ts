import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const settingsPageFile = path.resolve(__dirname, '../../../src/renderer/pages/SettingsPage.tsx')

describe('settings page ai save contract', () => {
  it('persists ai config with first-launch flag disabled', () => {
    const source = fs.readFileSync(settingsPageFile, 'utf-8')

    expect(source).toContain('await api.setConfig({ ai: aiConfig, isFirstLaunch: false })')
    expect(source).toContain('isFirstLaunch: false')
  })
})
