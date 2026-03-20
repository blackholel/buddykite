/**
 * MCP Tool Display Utilities
 *
 * Converts raw MCP tool names (mcp__server__tool_name) to user-friendly labels.
 */

const MCP_TOOL_PREFIX = 'mcp__'

const MCP_SERVER_LABELS: Record<string, string> = {
  'chrome-devtools': 'Chrome DevTools',
  'ai-browser': 'AI Browser',
  'codepilot-widget': 'Widget'
}

const MCP_TOOL_LABELS: Record<string, string> = {
  list_pages: 'List Pages',
  select_page: 'Select Page',
  new_page: 'Open Page',
  close_page: 'Close Page',
  navigate_page: 'Navigate',
  navigate: 'Navigate',
  wait_for: 'Wait',
  click: 'Click',
  hover: 'Hover',
  fill: 'Fill',
  fill_form: 'Fill Form',
  select_option: 'Select Option',
  drag: 'Drag',
  press_key: 'Press Key',
  upload_file: 'Upload File',
  take_snapshot: 'Analyze Page',
  snapshot: 'Analyze Page',
  take_screenshot: 'Take Screenshot',
  screenshot: 'Take Screenshot',
  evaluate_script: 'Run Script',
  list_network_requests: 'Inspect Network',
  get_network_request: 'Inspect Request',
  list_console_messages: 'Inspect Console',
  get_console_message: 'Inspect Console Message',
  performance_start_trace: 'Start Performance Trace',
  performance_stop_trace: 'Stop Performance Trace',
  performance_analyze_insight: 'Analyze Performance Insight'
}

export interface ParsedMcpToolName {
  serverName: string
  toolName: string
}

function toTitleCaseWords(value: string): string {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function humanizeIdentifier(value: string): string {
  const normalized = value.trim().replace(/[_-]+/g, ' ')
  if (!normalized) return value
  return toTitleCaseWords(normalized)
}

export function isMcpToolName(toolName?: string): boolean {
  return typeof toolName === 'string' && toolName.startsWith(MCP_TOOL_PREFIX)
}

export function parseMcpToolName(toolName: string): ParsedMcpToolName | null {
  if (!isMcpToolName(toolName)) return null

  const parts = toolName.split('__')
  if (parts.length < 3) return null

  const serverName = parts[1]?.trim()
  const rawToolName = parts.slice(2).join('__').trim()
  if (!serverName || !rawToolName) return null

  return {
    serverName,
    toolName: rawToolName
  }
}

export function getMcpServerDisplayName(serverName: string): string {
  return MCP_SERVER_LABELS[serverName] || humanizeIdentifier(serverName)
}

export function getMcpToolDisplayName(toolName: string): string {
  return MCP_TOOL_LABELS[toolName] || humanizeIdentifier(toolName)
}

export function formatToolNameForDisplay(toolName?: string): string {
  if (!toolName) return 'Tool'
  const parsed = parseMcpToolName(toolName)
  if (!parsed) return toolName
  const serverLabel = getMcpServerDisplayName(parsed.serverName)
  const toolLabel = getMcpToolDisplayName(parsed.toolName)
  return `MCP · ${serverLabel} · ${toolLabel}`
}

export function formatMcpActionDisplay(toolName: string): string {
  const parsed = parseMcpToolName(toolName)
  if (!parsed) return toolName
  const serverLabel = getMcpServerDisplayName(parsed.serverName)
  const actionLabel = getMcpToolDisplayName(parsed.toolName)
  return `${serverLabel} · ${actionLabel}`
}
