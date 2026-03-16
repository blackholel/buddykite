export const WIDGET_CSS_BRIDGE = /* css */ `
--color-background-primary: var(--background);
--color-background-secondary: var(--muted);
--color-background-tertiary: color-mix(in oklch, var(--muted-foreground) 10%, var(--background));
--color-background-info: var(--status-info-muted);
--color-background-danger: var(--status-error-muted);
--color-background-success: var(--status-success-muted);
--color-background-warning: var(--status-warning-muted);

--color-text-primary: var(--foreground);
--color-text-secondary: var(--muted-foreground);
--color-text-tertiary: color-mix(in oklch, var(--muted-foreground) 60%, transparent);
--color-text-info: var(--status-info-foreground);
--color-text-danger: var(--status-error-foreground);
--color-text-success: var(--status-success-foreground);
--color-text-warning: var(--status-warning-foreground);

--color-border-primary: color-mix(in oklch, var(--foreground) 40%, transparent);
--color-border-secondary: color-mix(in oklch, var(--border) 100%, transparent 0%);
--color-border-tertiary: var(--border);

--font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace;

--border-radius-md: 8px;
--border-radius-lg: 12px;
--border-radius-xl: 16px;

--color-chart-1: var(--chart-1);
--color-chart-2: var(--chart-2);
--color-chart-3: var(--chart-3);
--color-chart-4: var(--chart-4);
--color-chart-5: var(--chart-5);
`

const THEME_VAR_NAMES = [
  '--background', '--foreground', '--card', '--card-foreground',
  '--popover', '--popover-foreground',
  '--primary', '--primary-foreground',
  '--secondary', '--secondary-foreground',
  '--muted', '--muted-foreground',
  '--accent', '--accent-foreground',
  '--destructive', '--border', '--input', '--ring',
  '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5',
  '--status-success', '--status-success-foreground', '--status-success-muted',
  '--status-warning', '--status-warning-foreground', '--status-warning-muted',
  '--status-error', '--status-error-foreground', '--status-error-muted',
  '--status-info', '--status-info-foreground', '--status-info-muted'
]

export function resolveThemeVars(): Record<string, string> {
  if (typeof document === 'undefined') return {}
  const computed = getComputedStyle(document.documentElement)
  const vars: Record<string, string> = {}
  for (const name of THEME_VAR_NAMES) {
    const val = computed.getPropertyValue(name).trim()
    if (val) vars[name] = val
  }
  return vars
}

export function getWidgetIframeStyleBlock(resolvedVars: Record<string, string>): string {
  const rootVars = Object.entries(resolvedVars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join('\n')

  return `
:root {
${rootVars}
}
.dark { color-scheme: dark; }
body {
  ${WIDGET_CSS_BRIDGE}
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: 1.6;
  color: var(--color-text-primary);
  background: transparent;
}
* { box-sizing: border-box; }
a {
  color: var(--color-text-info);
  text-decoration: none;
}
a:hover { text-decoration: underline; }
`
}
