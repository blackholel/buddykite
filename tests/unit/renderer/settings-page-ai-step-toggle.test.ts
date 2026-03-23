import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const settingsPageFile = path.resolve(__dirname, '../../../src/renderer/pages/SettingsPage.tsx')

describe('settings page ai step toggle contract', () => {
  it('stores model setup expansion state per step and exposes independent toggles', () => {
    const source = fs.readFileSync(settingsPageFile, 'utf-8')

    expect(source).toContain('type ModelSetupStep = \'provider\' | \'account\' | \'model\'')
    expect(source).toContain('const [expandedModelSteps, setExpandedModelSteps] = useState<Record<ModelSetupStep, boolean>>')
    expect(source).toContain('const toggleModelStep = (step: ModelSetupStep) => {')
    expect(source).toContain('const openModelStep = (step: ModelSetupStep) => {')
    expect(source).toContain('expandedModelSteps.provider')
    expect(source).toContain('expandedModelSteps.account')
    expect(source).toContain('expandedModelSteps.model')
  })
})
