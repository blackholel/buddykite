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
const COMPLETE_FENCE_RE = /```show-widget\s*\n?([\s\S]*?)\n?\s*```/g
const SHOW_WIDGET_OPEN = '```show-widget'

export const CDN_WHITELIST = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'esm.sh'
]

function sanitizeAttributeUrls(html: string): string {
  return html.replace(
    /\s+(href|src|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']*))/gi,
    (match, _attr: string, dq?: string, sq?: string, uq?: string) => {
      const url = (dq ?? sq ?? uq ?? '').trim()
      if (DANGEROUS_URL_RE.test(url)) return ''
      return match
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
  try {
    const json = JSON.parse(fenceBody)
    if (json?.widget_code) {
      return { title: json.title || undefined, widget_code: String(json.widget_code) }
    }
  } catch {
    // expected on truncation
  }

  const keyIdx = fenceBody.indexOf('"widget_code"')
  if (keyIdx === -1) return null
  const colonIdx = fenceBody.indexOf(':', keyIdx + 13)
  if (colonIdx === -1) return null
  const quoteIdx = fenceBody.indexOf('"', colonIdx + 1)
  if (quoteIdx === -1) return null

  let raw = fenceBody.slice(quoteIdx + 1)
  raw = raw.replace(/"\s*\}\s*$/, '')
  if (raw.endsWith('\\')) raw = raw.slice(0, -1)

  const titleMatch = fenceBody.match(/"title"\s*:\s*"([^"]*?)"/)
  return {
    title: titleMatch?.[1] || undefined,
    widget_code: decodeJsonLikeString(raw)
  }
}

function truncateUnclosedScript(code: string): { html: string; truncated: boolean } {
  const lastScript = code.lastIndexOf('<script')
  if (lastScript === -1) return { html: code, truncated: false }
  const after = code.slice(lastScript)
  if (/<script[\s\S]*?<\/script>/i.test(after)) return { html: code, truncated: false }
  return { html: code.slice(0, lastScript).trim(), truncated: true }
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
  )
}

export function sanitizeForIframe(html: string): string {
  return sanitizeAttributeUrls(
    html
      .replace(DANGEROUS_TAGS, '')
      .replace(DANGEROUS_VOID, '')
      .replace(/\u0000/g, '')
  )
}

function fallbackTextSegment(text: string): ShowWidgetSegment[] {
  if (!text) return []
  return [{ type: 'text', key: `t-0`, content: text }]
}

export function parseAllShowWidgets(text: string): ShowWidgetSegment[] {
  const segments: ShowWidgetSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = COMPLETE_FENCE_RE.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index)
    if (before) {
      segments.push({ type: 'text', key: `t-${segments.length}`, content: before })
    }

    try {
      const json = JSON.parse(match[1])
      if (json?.widget_code) {
        segments.push({
          type: 'widget',
          key: `w-${match.index}`,
          title: json.title || undefined,
          widgetCode: String(json.widget_code),
          isPartial: false
        })
      } else {
        segments.push({ type: 'text', key: `t-${segments.length}`, content: match[0] })
      }
    } catch {
      segments.push({ type: 'text', key: `t-${segments.length}`, content: match[0] })
    }

    lastIndex = match.index + match[0].length
  }

  const remaining = text.slice(lastIndex)
  if (remaining) segments.push({ type: 'text', key: `t-${segments.length}`, content: remaining })
  if (segments.length === 0) {
    return fallbackTextSegment(text)
  }
  return segments
}

export function computePartialWidgetKey(content: string, _openFenceIndex?: number, _title?: string): string {
  const openFenceIndex =
    typeof _openFenceIndex === 'number' && Number.isFinite(_openFenceIndex)
      ? _openFenceIndex
      : content.lastIndexOf(SHOW_WIDGET_OPEN)
  if (openFenceIndex < 0) return 'w-0'
  return `w-${openFenceIndex}`
}

export function parseShowWidgetsForStreaming(content: string): ShowWidgetSegment[] {
  const completed = parseAllShowWidgets(content)
  const openFenceIndex = content.lastIndexOf(SHOW_WIDGET_OPEN)

  if (openFenceIndex < 0) {
    return completed.length > 0 ? completed : fallbackTextSegment(content)
  }

  const completeBeforeOpen = parseAllShowWidgets(content.slice(0, openFenceIndex))
  const tailAfterOpen = content.slice(openFenceIndex + SHOW_WIDGET_OPEN.length)
  const hasClosedTail = /```/.test(tailAfterOpen)
  if (hasClosedTail) {
    return completed
  }

  const segments: ShowWidgetSegment[] = completeBeforeOpen.length > 0 ? [...completeBeforeOpen] : []
  if (segments.length === 0 && openFenceIndex > 0) {
    const before = content.slice(0, openFenceIndex)
    if (before) {
      segments.push({ type: 'text', key: `t-0`, content: before })
    }
  }

  const fenceBody = content.slice(openFenceIndex + SHOW_WIDGET_OPEN.length).trim()
  const partial = extractTruncatedWidget(fenceBody)
  if (!partial?.widget_code) {
    segments.push({
      type: 'text',
      key: `t-${segments.length}`,
      content: content.slice(openFenceIndex)
    })
    return segments.length > 0 ? segments : fallbackTextSegment(content)
  }

  const truncated = truncateUnclosedScript(partial.widget_code)
  const cleaned = sanitizeForStreaming(truncated.html)
  segments.push({
    type: 'widget',
    key: computePartialWidgetKey(content, openFenceIndex, partial.title),
    title: partial.title,
    widgetCode: cleaned,
    isPartial: true,
    scriptsTruncated: truncated.truncated
  })

  return segments.length > 0 ? segments : fallbackTextSegment(content)
}

export function buildReceiverSrcdoc(styleBlock = '', isDark = false): string {
  const cspDomains = CDN_WHITELIST.map(d => `https://${d}`).join(' ')
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
var _t=null,_first=true;
function _h(){
if(_t)clearTimeout(_t);
_t=setTimeout(function(){
var h=document.body.scrollHeight;
if(h>0)parent.postMessage({type:'widget:resize',height:h,first:_first},'*');
_first=false;
},60);
}
var _ro=new ResizeObserver(_h);
_ro.observe(document.body);
function applyHtml(html){
root.innerHTML=html;
_h();
}
function finalizeHtml(html){
var tmp=document.createElement('div');
tmp.innerHTML=html;
var ss=tmp.querySelectorAll('script');
var scripts=[];
for(var i=0;i<ss.length;i++){
scripts.push({src:ss[i].src||'',text:ss[i].textContent||'',attrs:[]});
for(var j=0;j<ss[i].attributes.length;j++){
var a=ss[i].attributes[j];
if(a.name!=='src')scripts[scripts.length-1].attrs.push({name:a.name,value:a.value});
}
ss[i].remove();
}
var visualHtml=tmp.innerHTML;
if(root.innerHTML!==visualHtml)root.innerHTML=visualHtml;
for(var i=0;i<scripts.length;i++){
var n=document.createElement('script');
if(scripts[i].src)n.src=scripts[i].src;
else if(scripts[i].text)n.textContent=scripts[i].text;
for(var j=0;j<scripts[i].attrs.length;j++)n.setAttribute(scripts[i].attrs[j].name,scripts[i].attrs[j].value);
root.appendChild(n);
}
_h();
}
window.addEventListener('message',function(e){
if(!e.data)return;
switch(e.data.type){
case 'widget:update':
applyHtml(e.data.html||'');
break;
case 'widget:finalize':
finalizeHtml(e.data.html||'');
setTimeout(_h,150);
break;
case 'widget:theme':
var r=document.documentElement,v=e.data.vars;
if(v)for(var k in v)r.style.setProperty(k,v[k]);
if(typeof e.data.isDark==='boolean')r.className=e.data.isDark?'dark':'';
setTimeout(_h,100);
break;
}
});
document.addEventListener('click',function(e){
var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;
if(!a)return;var h=a.getAttribute('href');
if(!h||h.charAt(0)==='#')return;
e.preventDefault();
parent.postMessage({type:'widget:link',href:h},'*');
});
parent.postMessage({type:'widget:ready'},'*');
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
