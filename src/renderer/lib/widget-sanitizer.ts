export interface ShowWidgetData {
  title?: string
  widget_code: string
}

export type ShowWidgetSegment =
  | { type: 'text'; key: string; content: string }
  | {
      type: 'widget'
      key: string
      title?: string
      widgetCode: string
      isPartial: boolean
      scriptsTruncated?: boolean
    }

const DANGEROUS_TAGS = /<(iframe|object|embed|meta|link|base|form)[\s>][\s\S]*?<\/\1>/gi
const DANGEROUS_VOID = /<(iframe|object|embed|meta|link|base)\b[^>]*\/?>/gi
const SCRIPT_TAG_RE = /<script[\s\S]*?<\/script>/gi
const SCRIPT_OPEN_RE = /<script\b[^>]*\/?>/gi
const INLINE_EVENT_RE = /\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"']*)/gi
const DANGEROUS_URL_RE = /^\s*(javascript|data|vbscript|file|filesystem)\s*:/i
const SHOW_WIDGET_OPEN_FALLBACK = '```show-widget'
const SHOW_WIDGET_OPEN_RE = /```(?:show-widget|show_widget)\b/gi
const COMPLETE_SHOW_WIDGET_RE = /```(?:show-widget|show_widget)\s*\n?([\s\S]*?)\n?\s*```/gi

export const CDN_WHITELIST = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'esm.sh'
]

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function toDisplayText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function renderStructuredTableWidget(
  title: string | undefined,
  description: string | undefined,
  record: Record<string, unknown>
): ShowWidgetData {
  const props = asRecord(record.props) || {}
  const rows = asArray(props.rows)
  const columns = asArray(props.columns).map((item) => toDisplayText(item)).filter(Boolean)
  const normalizedColumns =
    columns.length > 0
      ? columns
      : (() => {
          const firstRow = rows.find((row) => asRecord(row))
          if (!firstRow || !asRecord(firstRow)) return ['列1', '列2', '列3']
          return Object.keys(asRecord(firstRow) as Record<string, unknown>)
        })()

  const headerHtml = normalizedColumns
    .map((column) => `<th style="text-align:left;padding:8px 10px;border-bottom:1px solid rgba(148,163,184,.35);font-size:12px;font-weight:600;white-space:nowrap;">${escapeHtml(column)}</th>`)
    .join('')

  const bodyHtml = rows
    .map((row) => {
      const rec = asRecord(row)
      if (rec) {
        return `<tr>${normalizedColumns
          .map(
            (column) =>
              `<td style="padding:8px 10px;border-bottom:1px solid rgba(148,163,184,.2);vertical-align:top;">${escapeHtml(toDisplayText(rec[column]))}</td>`
          )
          .join('')}</tr>`
      }

      const arr = asArray(row)
      if (arr.length > 0) {
        const rowHtml = normalizedColumns
          .map(
            (_column, idx) =>
              `<td style="padding:8px 10px;border-bottom:1px solid rgba(148,163,184,.2);vertical-align:top;">${escapeHtml(toDisplayText(arr[idx]))}</td>`
          )
          .join('')
        return `<tr>${rowHtml}</tr>`
      }

      return `<tr><td colspan="${Math.max(normalizedColumns.length, 1)}" style="padding:8px 10px;border-bottom:1px solid rgba(148,163,184,.2);vertical-align:top;">${escapeHtml(
        toDisplayText(row)
      )}</td></tr>`
    })
    .join('')

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:12px;border:1px solid rgba(148,163,184,.35);border-radius:12px;background:var(--color-bg,var(--background,#fff));">
  ${title ? `<div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escapeHtml(title)}</div>` : ''}
  ${description ? `<div style="font-size:12px;opacity:.7;margin-bottom:8px;">${escapeHtml(description)}</div>` : ''}
  <div style="overflow:auto;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;line-height:1.45;">
      <thead><tr>${headerHtml}</tr></thead>
      <tbody>${bodyHtml || `<tr><td style="padding:10px;opacity:.7;">暂无数据</td></tr>`}</tbody>
    </table>
  </div>
</div>`
  return { title, widget_code: html }
}

function renderStructuredListWidget(
  title: string | undefined,
  description: string | undefined,
  record: Record<string, unknown>
): ShowWidgetData {
  const props = asRecord(record.props) || {}
  const items = asArray(props.items).length > 0 ? asArray(props.items) : asArray((record as Record<string, unknown>).items)
  const listHtml = items
    .map((item) => {
      const rec = asRecord(item)
      if (rec) {
        const label = escapeHtml(toDisplayText(rec.label ?? rec.title ?? rec.name ?? rec.value ?? item))
        const detail = escapeHtml(toDisplayText(rec.detail ?? rec.description ?? rec.desc ?? ''))
        return `<li style="padding:8px 0;border-bottom:1px dashed rgba(148,163,184,.25);"><div style="font-size:13px;">${label}</div>${
          detail ? `<div style="font-size:12px;opacity:.72;margin-top:2px;">${detail}</div>` : ''
        }</li>`
      }
      return `<li style="padding:8px 0;border-bottom:1px dashed rgba(148,163,184,.25);font-size:13px;">${escapeHtml(
        toDisplayText(item)
      )}</li>`
    })
    .join('')

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:12px;border:1px solid rgba(148,163,184,.35);border-radius:12px;background:var(--color-bg,var(--background,#fff));">
  ${title ? `<div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escapeHtml(title)}</div>` : ''}
  ${description ? `<div style="font-size:12px;opacity:.7;margin-bottom:8px;">${escapeHtml(description)}</div>` : ''}
  <ul style="margin:0;padding-left:18px;list-style:disc;">${listHtml || '<li style="font-size:12px;opacity:.72;">暂无内容</li>'}</ul>
</div>`
  return { title, widget_code: html }
}

function renderStructuredMetricWidget(
  title: string | undefined,
  description: string | undefined,
  record: Record<string, unknown>
): ShowWidgetData {
  const props = asRecord(record.props) || {}
  const value = toDisplayText(props.value ?? record.value ?? '-')
  const delta = toDisplayText(props.delta ?? '')
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:14px;border:1px solid rgba(148,163,184,.35);border-radius:12px;background:var(--color-bg,var(--background,#fff));">
  ${title ? `<div style="font-size:12px;opacity:.7;">${escapeHtml(title)}</div>` : ''}
  <div style="font-size:28px;font-weight:750;line-height:1.2;margin:4px 0;">${escapeHtml(value)}</div>
  ${delta ? `<div style="font-size:12px;opacity:.78;">${escapeHtml(delta)}</div>` : ''}
  ${description ? `<div style="font-size:12px;opacity:.72;margin-top:6px;">${escapeHtml(description)}</div>` : ''}
</div>`
  return { title, widget_code: html }
}

function renderStructuredTimelineWidget(
  title: string | undefined,
  description: string | undefined,
  record: Record<string, unknown>
): ShowWidgetData {
  const props = asRecord(record.props) || {}
  const items = asArray(props.items)
  const itemHtml = items
    .map((item) => {
      const rec = asRecord(item)
      const when = escapeHtml(toDisplayText(rec?.time ?? rec?.date ?? rec?.when ?? ''))
      const label = escapeHtml(toDisplayText(rec?.label ?? rec?.title ?? rec?.name ?? item))
      const detail = escapeHtml(toDisplayText(rec?.detail ?? rec?.description ?? ''))
      return `<li style="position:relative;padding:0 0 12px 18px;list-style:none;">
        <span style="position:absolute;left:3px;top:2px;width:8px;height:8px;border-radius:50%;background:rgba(59,130,246,.85);"></span>
        ${when ? `<div style="font-size:11px;opacity:.6;">${when}</div>` : ''}
        <div style="font-size:13px;font-weight:600;">${label}</div>
        ${detail ? `<div style="font-size:12px;opacity:.72;">${detail}</div>` : ''}
      </li>`
    })
    .join('')

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:12px;border:1px solid rgba(148,163,184,.35);border-radius:12px;background:var(--color-bg,var(--background,#fff));">
  ${title ? `<div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escapeHtml(title)}</div>` : ''}
  ${description ? `<div style="font-size:12px;opacity:.7;margin-bottom:8px;">${escapeHtml(description)}</div>` : ''}
  <ul style="margin:0;padding:0;">${itemHtml || '<li style="font-size:12px;opacity:.72;list-style:none;">暂无时间线事件</li>'}</ul>
</div>`
  return { title, widget_code: html }
}

function renderStructuredWidgetFallback(
  type: string,
  title: string | undefined,
  description: string | undefined,
  record: Record<string, unknown>
): ShowWidgetData {
  const props = asRecord(record.props) || {}
  const payload = escapeHtml(JSON.stringify(props, null, 2))
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:12px;border:1px solid rgba(148,163,184,.35);border-radius:12px;background:var(--color-bg,var(--background,#fff));">
  ${title ? `<div style="font-weight:700;font-size:14px;margin-bottom:4px;">${escapeHtml(title)}</div>` : ''}
  <div style="font-size:12px;opacity:.7;margin-bottom:8px;">${escapeHtml(description || `结构化 widget：${type}`)}</div>
  <pre style="margin:0;padding:8px;border-radius:8px;background:rgba(148,163,184,.12);font-size:11px;line-height:1.45;overflow:auto;">${payload}</pre>
</div>`
  return { title, widget_code: html }
}

function normalizeWidgetPayload(payload: unknown): ShowWidgetData | null {
  const record = asRecord(payload)
  if (!record) return null

  const title = typeof record.title === 'string' ? record.title : undefined
  const widgetCode = record.widget_code ?? record.widgetCode
  if (widgetCode != null) {
    return {
      title,
      widget_code: String(widgetCode)
    }
  }

  const type = typeof record.type === 'string' ? record.type.trim().toLowerCase() : ''
  if (!type) return null
  const description = typeof record.description === 'string' ? record.description : undefined

  if (type === 'table') return renderStructuredTableWidget(title, description, record)
  if (type === 'list') return renderStructuredListWidget(title, description, record)
  if (type === 'metric' || type === 'kpi') return renderStructuredMetricWidget(title, description, record)
  if (type === 'timeline') return renderStructuredTimelineWidget(title, description, record)
  return renderStructuredWidgetFallback(type, title, description, record)
}

function parseWidgetPayload(rawPayload: string): ShowWidgetData | null {
  try {
    const parsed = JSON.parse(rawPayload)
    return normalizeWidgetPayload(parsed)
  } catch {
    return null
  }
}

function findLastShowWidgetFenceStart(content: string): number {
  SHOW_WIDGET_OPEN_RE.lastIndex = 0
  let lastIndex = -1
  let match: RegExpExecArray | null
  while ((match = SHOW_WIDGET_OPEN_RE.exec(content)) !== null) {
    lastIndex = match.index
  }
  SHOW_WIDGET_OPEN_RE.lastIndex = 0
  return lastIndex
}

function getFenceTokenLengthAt(content: string, startIndex: number): number {
  if (startIndex < 0) return SHOW_WIDGET_OPEN_FALLBACK.length
  const match = /^```(?:show-widget|show_widget)\b/i.exec(content.slice(startIndex))
  return match?.[0]?.length || SHOW_WIDGET_OPEN_FALLBACK.length
}

function sanitizeAttributeUrls(html: string): string {
  return html.replace(
    /\s+(href|src|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']*))/gi,
    (_match, attr: string, dq?: string, sq?: string, uq?: string) => {
      const url = (dq ?? sq ?? uq ?? '').trim()
      if (!DANGEROUS_URL_RE.test(url)) {
        return _match
      }

      const normalizedAttr = attr.toLowerCase()
      if (normalizedAttr === 'href' || normalizedAttr === 'xlink:href') {
        return ` ${attr}="#"`
      }
      return ''
    }
  )
}

function decodeJsonLikeString(input: string): string {
  try {
    return input
      .replace(/\\\\/g, '\x00BACKSLASH\x00')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\x00BACKSLASH\x00/g, '\\')
  } catch {
    return input
  }
}

function extractTruncatedWidget(fenceBody: string): ShowWidgetData | null {
  const parsedPayload = parseWidgetPayload(fenceBody)
  if (parsedPayload?.widget_code) {
    return parsedPayload
  }

  const keyMatch = fenceBody.match(/"(widget_code|widgetCode)"\s*:\s*"/)
  if (!keyMatch || keyMatch.index == null) return null

  const startIndex = keyMatch.index + keyMatch[0].length
  let raw = fenceBody.slice(startIndex)
  raw = raw.replace(/"\s*}\s*$/, '')
  if (raw.endsWith('\\')) {
    raw = raw.slice(0, -1)
  }

  const titleMatch = fenceBody.match(/"title"\s*:\s*"([^"]*?)"/)
  return {
    title: titleMatch ? decodeJsonLikeString(titleMatch[1]) : undefined,
    widget_code: decodeJsonLikeString(raw)
  }
}

function truncateUnclosedScript(code: string): { html: string; truncated: boolean } {
  const lastScriptOpen = code.lastIndexOf('<script')
  if (lastScriptOpen < 0) return { html: code, truncated: false }
  const tail = code.slice(lastScriptOpen)
  if (/<script[\s\S]*?<\/script>/i.test(tail)) {
    return { html: code, truncated: false }
  }
  return { html: code.slice(0, lastScriptOpen).trim(), truncated: true }
}

function toTextFallback(content: string): ShowWidgetSegment[] {
  if (!content) return []
  return [{ type: 'text', key: 't-0', content }]
}

export function normalizeVisualWidgetHtml(html: string): string {
  return html.replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim()
}

export function sanitizeForStreaming(html: string): string {
  return sanitizeAttributeUrls(
    html
      .replace(DANGEROUS_TAGS, '')
      .replace(DANGEROUS_VOID, '')
      .replace(INLINE_EVENT_RE, '')
      .replace(SCRIPT_TAG_RE, '')
      .replace(SCRIPT_OPEN_RE, '')
      .replace(/\u0000/g, '')
  )
}

export function sanitizeForIframe(html: string): string {
  return sanitizeAttributeUrls(
    html
      .replace(DANGEROUS_TAGS, '')
      .replace(DANGEROUS_VOID, '')
      .replace(INLINE_EVENT_RE, '')
      .replace(/\u0000/g, '')
  )
}

export function parseAllShowWidgets(text: string): ShowWidgetSegment[] {
  const source = text || ''
  const segments: ShowWidgetSegment[] = []
  let cursor = 0
  let match: RegExpExecArray | null

  COMPLETE_SHOW_WIDGET_RE.lastIndex = 0
  while ((match = COMPLETE_SHOW_WIDGET_RE.exec(source)) !== null) {
    const before = source.slice(cursor, match.index)
    if (before) {
      segments.push({ type: 'text', key: `t-${segments.length}`, content: before })
    }

    const parsedWidget = parseWidgetPayload(match[1])
    if (parsedWidget?.widget_code) {
      segments.push({
        type: 'widget',
        key: `w-${match.index}`,
        title: parsedWidget.title,
        widgetCode: String(parsedWidget.widget_code),
        isPartial: false
      })
    } else {
      segments.push({ type: 'text', key: `t-${segments.length}`, content: match[0] })
    }

    cursor = match.index + match[0].length
  }
  COMPLETE_SHOW_WIDGET_RE.lastIndex = 0

  const tail = source.slice(cursor)
  if (tail) {
    segments.push({ type: 'text', key: `t-${segments.length}`, content: tail })
  }
  return segments.length > 0 ? segments : toTextFallback(source)
}

export function computePartialWidgetKey(content: string, openFenceIndex?: number, _title?: string): string {
  const resolvedFenceIndex =
    typeof openFenceIndex === 'number' && Number.isFinite(openFenceIndex)
      ? openFenceIndex
      : findLastShowWidgetFenceStart(content)
  return resolvedFenceIndex < 0 ? 'w-0' : `w-${resolvedFenceIndex}`
}

export function parseShowWidgetsForStreaming(content: string): ShowWidgetSegment[] {
  const source = content || ''
  const completedSegments = parseAllShowWidgets(source)
  const openFenceIndex = findLastShowWidgetFenceStart(source)

  if (openFenceIndex < 0) {
    return completedSegments.length > 0 ? completedSegments : toTextFallback(source)
  }

  const openFenceTokenLength = getFenceTokenLengthAt(source, openFenceIndex)
  const tailAfterFence = source.slice(openFenceIndex + openFenceTokenLength)
  const hasClosedTail = /```/.test(tailAfterFence)
  if (hasClosedTail) {
    return completedSegments
  }

  const prefixSegments = parseAllShowWidgets(source.slice(0, openFenceIndex))
  const segments: ShowWidgetSegment[] = prefixSegments.length > 0 ? [...prefixSegments] : []

  const fenceBody = source.slice(openFenceIndex + openFenceTokenLength).trim()
  const partial = extractTruncatedWidget(fenceBody)
  if (!partial?.widget_code) {
    segments.push({
      type: 'text',
      key: `t-${segments.length}`,
      content: source.slice(openFenceIndex)
    })
    return segments.length > 0 ? segments : toTextFallback(source)
  }

  const truncated = truncateUnclosedScript(partial.widget_code)
  segments.push({
    type: 'widget',
    key: computePartialWidgetKey(source, openFenceIndex, partial.title),
    title: partial.title,
    widgetCode: sanitizeForStreaming(truncated.html),
    isPartial: true,
    scriptsTruncated: truncated.truncated
  })

  return segments.length > 0 ? segments : toTextFallback(source)
}

export function buildReceiverSrcdoc(styleBlock = '', isDark = false): string {
  const cspDomains = CDN_WHITELIST.map((domain) => `https://${domain}`).join(' ')
  const csp = [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${cspDomains}`,
    `style-src 'unsafe-inline' ${cspDomains}`,
    'img-src * data: blob:',
    `font-src * data: ${cspDomains}`,
    "connect-src 'none'",
    "base-uri 'none'"
  ].join('; ')

  const receiverScript = `(function(){
var root=document.getElementById('__root');
var timer=null;
var isFirstResize=true;
function post(msg){ parent.postMessage(msg,'*'); }
function emitResize(){
if(timer)clearTimeout(timer);
timer=setTimeout(function(){
var h=document.body.scrollHeight||0;
if(h>0)post({type:'widget:resize',height:h,first:isFirstResize});
isFirstResize=false;
},50);
}
function emitError(message){ post({type:'widget:error',message:String(message||'Widget receiver error')}); }
function applyHtml(html){
try{
root.innerHTML=html||'';
emitResize();
}catch(err){ emitError(err&&err.message?err.message:err); }
}
function finalizeHtml(html){
try{
var holder=document.createElement('div');
holder.innerHTML=html||'';
var scripts=holder.querySelectorAll('script');
var queue=[];
for(var i=0;i<scripts.length;i++){
var src=scripts[i].getAttribute('src')||'';
var attrs=[];
for(var j=0;j<scripts[i].attributes.length;j++){
var a=scripts[i].attributes[j];
if(a.name!=='src')attrs.push({name:a.name,value:a.value});
}
queue.push({src:src,text:scripts[i].textContent||'',attrs:attrs});
scripts[i].remove();
}
var visualHtml=holder.innerHTML;
if(root.innerHTML!==visualHtml){ root.innerHTML=visualHtml; }
for(var k=0;k<queue.length;k++){
var node=document.createElement('script');
if(queue[k].src){ node.src=queue[k].src; } else { node.textContent=queue[k].text; }
for(var m=0;m<queue[k].attrs.length;m++){
node.setAttribute(queue[k].attrs[m].name,queue[k].attrs[m].value);
}
root.appendChild(node);
}
emitResize();
}catch(err){ emitError(err&&err.message?err.message:err); }
}
function applyTheme(vars,isDark){
try{
var el=document.documentElement;
if(vars&&typeof vars==='object'){
for(var key in vars){ el.style.setProperty(key, String(vars[key])); }
}
if(typeof isDark==='boolean'){ el.className=isDark?'dark':''; }
setTimeout(emitResize,80);
}catch(err){ emitError(err&&err.message?err.message:err); }
}
window.addEventListener('message',function(event){
var data=event&&event.data?event.data:null;
if(!data||typeof data.type!=='string')return;
switch(data.type){
case 'widget:update':
applyHtml(data.html||'');
break;
case 'widget:finalize':
finalizeHtml(data.html||'');
setTimeout(emitResize,120);
break;
case 'widget:theme':
applyTheme(data.vars,data.isDark);
break;
}
});
document.addEventListener('click',function(event){
var target=event.target&&event.target.closest?event.target.closest('a[href]'):null;
if(!target)return;
var href=target.getAttribute('href');
if(!href||href.charAt(0)==='#')return;
event.preventDefault();
post({type:'widget:link',href:href});
});
window.addEventListener('error',function(event){
emitError(event&&event.message?event.message:'Widget runtime error');
});
window.addEventListener('unhandledrejection',function(event){
var reason=event&&event.reason?event.reason:'Widget promise rejection';
emitError(reason&&reason.message?reason.message:reason);
});
if(typeof ResizeObserver==='function'){
var ro=new ResizeObserver(emitResize);
ro.observe(document.body);
}
post({type:'widget:ready'});
setTimeout(emitResize,0);
})();`

  return `<!DOCTYPE html>
<html class="${isDark ? 'dark' : ''}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>${styleBlock}</style>
</head>
<body style="margin:0;padding:0;background:transparent;">
<div id="__root"></div>
<script>${receiverScript}</script>
</body>
</html>`
}
