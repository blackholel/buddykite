import { describe, expect, it } from 'vitest'
import { calculateLineDiffStats } from '../../../src/shared/utils/diff-stats'

const compactWidgetCode = '<div><section><h1>标题</h1><p>正文</p></section><style>.card{color:red;display:flex;}</style></div>'

function widgetMarkdown(widgetCode = compactWidgetCode): string {
  return [
    '# Widget',
    '',
    '```show-widget',
    JSON.stringify({ title: 'Widget', widget_code: widgetCode }),
    '```',
    ''
  ].join('\n')
}

describe('diff stats widget markdown', () => {
  it('keeps normal markdown physical-line counting by default', () => {
    expect(calculateLineDiffStats('', widgetMarkdown())).toEqual({ added: 5, removed: 0 })
  })

  it('counts exported widget markdown by embedded widget code for widgets paths', () => {
    expect(calculateLineDiffStats('', widgetMarkdown(), { filePath: 'widgets/widget.md' })).toEqual({
      added: 11,
      removed: 0
    })
  })
})
