import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildReceiverSrcdoc,
  normalizeVisualWidgetHtml,
  sanitizeForIframe,
  sanitizeForStreaming
} from '../../lib/widget-sanitizer'
import { getWidgetIframeStyleBlock, resolveThemeVars } from '../../lib/widget-css-bridge'

interface WidgetRendererProps {
  widgetCode: string
  isPartial: boolean
  title?: string
  showOverlay?: boolean
  widgetKey?: string
}

const MAX_IFRAME_HEIGHT = 2000
const STREAM_DEBOUNCE = 120
const CDN_PATTERN = /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|esm\.sh/

const _heightCache = new Map<string, number>()

function getHeightCacheKey(code: string, widgetKey?: string): string {
  return widgetKey || code.slice(0, 200)
}

export function WidgetRenderer({
  widgetCode,
  isPartial,
  title,
  showOverlay,
  widgetKey
}: WidgetRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSentRef = useRef('')
  const finalizedRef = useRef(!isPartial)
  const cacheKey = useMemo(() => getHeightCacheKey(widgetCode, widgetKey), [widgetCode, widgetKey])
  const hasReceivedFirstHeight = useRef((_heightCache.get(cacheKey) || 0) > 0)
  const heightLockedRef = useRef(false)

  const [iframeReady, setIframeReady] = useState(false)
  const [iframeHeight, setIframeHeight] = useState(() => _heightCache.get(cacheKey) || 0)
  const [finalized, setFinalized] = useState(false)

  const hasCDN = useMemo(() => CDN_PATTERN.test(widgetCode), [widgetCode])

  const srcdoc = useMemo(() => {
    const isDark = typeof document !== 'undefined'
      && document.documentElement.classList.contains('dark')
    const vars = resolveThemeVars()
    const styleBlock = getWidgetIframeStyleBlock(vars)
    return buildReceiverSrcdoc(styleBlock, isDark)
  }, [])

  useEffect(() => {
    if (!isPartial) {
      finalizedRef.current = true
      heightLockedRef.current = true
      setFinalized(true)
    }
  }, [isPartial])

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.data || typeof e.data.type !== 'string') return
      if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return

      switch (e.data.type) {
        case 'widget:ready':
          setIframeReady(true)
          break
        case 'widget:resize':
          if (typeof e.data.height === 'number' && e.data.height > 0) {
            const newH = Math.min(e.data.height + 2, MAX_IFRAME_HEIGHT)
            if (heightLockedRef.current) {
              setIframeHeight((prev) => {
                const h = Math.max(prev, newH)
                _heightCache.set(cacheKey, h)
                return h
              })
              break
            }

            _heightCache.set(cacheKey, newH)
            if (!hasReceivedFirstHeight.current) {
              hasReceivedFirstHeight.current = true
              const el = iframeRef.current
              if (el) {
                el.style.transition = 'none'
                void el.offsetHeight
              }
              setIframeHeight(newH)
              requestAnimationFrame(() => {
                if (el) el.style.transition = 'height 0.3s ease-out'
              })
            } else {
              setIframeHeight(newH)
            }
          }
          break
        case 'widget:link': {
          const href = String(e.data.href || '')
          if (href && !/^\s*(javascript|data)\s*:/i.test(href)) {
            window.open(href, '_blank', 'noopener,noreferrer')
          }
          break
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [cacheKey])

  const sendUpdate = useCallback((html: string) => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    const visual = normalizeVisualWidgetHtml(html)
    if (visual === lastSentRef.current) return
    lastSentRef.current = visual
    iframe.contentWindow.postMessage({ type: 'widget:update', html }, '*')
  }, [])

  useEffect(() => {
    if (!isPartial || !iframeReady) return
    const sanitized = sanitizeForStreaming(widgetCode)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => sendUpdate(sanitized), STREAM_DEBOUNCE)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [widgetCode, isPartial, iframeReady, sendUpdate])

  useEffect(() => {
    if (isPartial || !iframeReady || finalizedRef.current) return
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return

    const sanitized = sanitizeForIframe(widgetCode)
    finalizedRef.current = true
    lastSentRef.current = normalizeVisualWidgetHtml(sanitized)
    heightLockedRef.current = true
    iframe.contentWindow.postMessage({ type: 'widget:finalize', html: sanitized }, '*')
    setFinalized(true)
  }, [isPartial, iframeReady, widgetCode])

  useEffect(() => {
    if (!iframeReady) return

    const pushTheme = () => {
      const nowDark = document.documentElement.classList.contains('dark')
      const vars = resolveThemeVars()
      iframeRef.current?.contentWindow?.postMessage({ type: 'widget:theme', vars, isDark: nowDark }, '*')
    }

    pushTheme()
    const observer = new MutationObserver(() => pushTheme())
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [iframeReady])

  const showLoadingOverlay = hasCDN && !isPartial && iframeReady && !finalized
  const overlayVisible = showLoadingOverlay || Boolean(showOverlay)

  return (
    <div className="group/widget relative my-1" data-widget-key={widgetKey || undefined}>
      <iframe
        ref={iframeRef}
        sandbox="allow-scripts"
        srcDoc={srcdoc}
        title={title || 'Widget'}
        onLoad={() => setIframeReady(true)}
        style={{
          width: '100%',
          height: iframeHeight,
          border: 'none',
          overflow: 'hidden',
          transition: 'height 0.3s ease-out'
        }}
      />

      {overlayVisible && (
        <div className="widget-shimmer-overlay absolute inset-0 pointer-events-none rounded-lg" />
      )}
    </div>
  )
}
