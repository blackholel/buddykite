import { z } from 'zod'
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk'

export const WIDGET_SYSTEM_PROMPT = `
## Widget capability (minimal)
When user asks for visual blocks/widgets/charts/diagrams/tables/timelines/dashboards, render inline via \`show-widget\` fenced output by default.
Before first widget output in a turn, call \`codepilot_load_widget_guidelines\` when that tool is available; if unavailable, output valid \`show-widget\` directly.
Widget payload MUST be wrapped in this fence format exactly:
\`\`\`show-widget
{ ...valid JSON... }
\`\`\`
Do not use other fence tags for widget payload.
Do not create standalone html files or open external browser pages for visualization.
If the user asks to render now, output the widget fence directly in the same response instead of asking for confirmation first.
`

const WIDGET_GUIDELINES_TEXT = `# CodePilot Widget Guidelines

Use this guideline when you need structured UI/widget rendering in chat.

## 1) Required output contract
- Widget payload MUST be a valid JSON object.
- Widget payload MUST appear in exactly one fenced block with language tag: show-widget.
- Do not wrap widget JSON with markdown code tags other than show-widget.
- Put explanation text outside the fence (before or after), never inside JSON fields unless needed as content.

Required wrapper:
\`\`\`show-widget
{ "title": "Optional title", "widget_code": "<div>...</div>" }
\`\`\`

## 2) Minimal JSON schema
- title: string (optional)
- widget_code: string HTML snippet (required)
- widget_code should be self-contained and renderable in iframe sandbox

Recommended skeleton:
{
  "title": "Optional title",
  "widget_code": "<div style=\\"padding:16px\\">...</div>"
}

## 3) Data quality requirements
- Ensure JSON is parseable (double quotes, no trailing commas, no comments).
- Keep fields deterministic and explicit.
- Keep arrays/objects shallow unless nested structure is required.
- Avoid embedding extremely large blobs; summarize and provide compact data.

## 4) Widget type guidance
- table: Use for records/rows comparison.
- chart: Use for trend/comparison/distribution (specify axis + series in props).
- metric: Use for KPI-style single values.
- timeline: Use for chronological events.
- kanban: Use for status-driven workflow cards.
- form: Use for input collection.

## 5) Examples
Example A:
\`\`\`show-widget
{
  "title": "Build Success Rate",
  "widget_code": "<div style=\\"font-family:sans-serif;padding:12px;border:1px solid #ddd;border-radius:10px\\"><div style=\\"font-size:12px;opacity:.7\\">Build Success Rate</div><div style=\\"font-size:28px;font-weight:700\\">98.4%</div><div style=\\"font-size:12px;color:#16a34a\\">+1.2% vs last week</div></div>"
}
\`\`\`

Example B:
\`\`\`show-widget
{
  "title": "Mini Sales Line Chart",
  "widget_code": "<svg width=\\"100%\\" height=\\"200\\" viewBox=\\"0 0 600 200\\" xmlns=\\"http://www.w3.org/2000/svg\\"><polyline fill=\\"none\\" stroke=\\"#2563eb\\" stroke-width=\\"3\\" points=\\"20,170 120,140 220,150 320,95 420,110 520,60\\"/></svg>"
}
\`\`\`

## 6) Common mistakes to avoid
- Invalid JSON syntax.
- Using \`json\` fence instead of \`show-widget\`.
- Returning multiple widget fences when one merged payload is enough.
- Missing required key: widget_code.
`

const codepilot_load_widget_guidelines = tool(
  'codepilot_load_widget_guidelines',
  'Load widget rendering guidelines, output schema, and show-widget fence rules.',
  {
    topic: z.string().optional().describe('Optional topic focus, e.g. "chart", "table", "timeline"')
  },
  async (_args) => {
    return {
      content: [{ type: 'text' as const, text: WIDGET_GUIDELINES_TEXT }]
    }
  }
)

export function createWidgetMcpServer() {
  return createSdkMcpServer({
    name: 'codepilot-widget',
    version: '1.0.0',
    tools: [codepilot_load_widget_guidelines]
  })
}
