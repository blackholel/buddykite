import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const settingsPageFile = path.resolve(__dirname, '../../../src/renderer/pages/SettingsPage.tsx')
const globalStylesFile = path.resolve(__dirname, '../../../src/renderer/assets/styles/globals.css')

describe('settings page model split scroll contract', () => {
  it('uses isolated scroll containers for the model settings split layout', () => {
    const pageSource = fs.readFileSync(settingsPageFile, 'utf-8')
    const stylesSource = fs.readFileSync(globalStylesFile, 'utf-8')

    expect(pageSource).toContain("activeSection === 'model' ? 'settings-modal-content settings-modal-content-model' : 'settings-modal-content'")
    expect(stylesSource).toContain('.settings-modal-content-model {')
    expect(stylesSource).toContain('overflow: hidden;')
    expect(stylesSource).toContain('.settings-model-layout {')
    expect(stylesSource).toContain('.settings-model-sidebar {')
    expect(stylesSource).toContain('.settings-model-content {')
  })
})
