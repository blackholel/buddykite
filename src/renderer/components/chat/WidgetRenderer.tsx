import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildReceiverSrcdoc,
  normalizeVisualWidgetHtml,
  sanitizeForIframe,
  sanitizeForStreaming
} from '../../lib/widget-sanitizer'
import { getWidgetIframeStyleBlock, resolveThemeVars } from '../../lib/widget-css-bridge'
import { createWidgetStabilityEmitter } from '../../lib/widget-stability-events'

interface WidgetRendererProps {
  widgetCode: string
  isPartial: boolean
  title?: string
  showOverlay?: boolean
  widgetKey?: string
  runId?: string | null
  conversationId?: string | null
}

const MAX_IFRAME_HEIGHT = 2000
const STREAM_DEBOUNCE = 120
const CDN_PATTERN = /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com|esm\.sh/

const _heightCache = new Map<string, number>()

function getHeightCacheKey(code: string): string {
  return code.slice(0, 200)
}

export function WidgetRenderer({
  widgetCode,
  isPartial,
  title,
  showOverlay,
  widgetKey,
  runId,
  conversationId
}: WidgetRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSentRef = useRef('')
  const finalizedRef = useRef(false)
  const instanceId = useMemo(
    () => `${widgetKey || 'widget'}:${Math.random().toString(36).slice(2, 10)}`,
    [widgetKey]
  )
  const cacheKey = useMemo(() => getHeightCacheKey(widgetCode), [widgetCode])
  const hasReceivedFirstHeight = useRef((_heightCache.get(cacheKey) || 0) > 0)
  const heightLockedRef = useRef(false)

  const [iframeReady, setIframeReady] = useState(false)
  const [iframeHeight, setIframeHeight] = useState(() => _heightCache.get(cacheKey) || 0)
  const [finalized, setFinalized] = useState(false)
  const stabilityEmitter = useMemo(
    () =>
      createWidgetStabilityEmitter({
        runId,
        conversationId,
        widgetKey,
        instanceId
      }),
    [conversationId, instanceId, runId, widgetKey]
  )

  const hasCDN = useMemo(() => CDN_PATTERN.test(widgetCode), [widgetCode])

  const srcdoc = useMemo(() => {
    const isDark = typeof document !== 'undefined'
      && document.documentElement.classList.contains('dark')
    const vars = resolveThemeVars()
    const styleBlock = getWidgetIframeStyleBlock(vars)
    return buildReceiverSrcdoc(styleBlock, isDark)
  }, [])

  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.data || typeof e.data.type !== 'string') return
      if (iframeRef.current && e.source !== iframeRef.current.contentWindow) return

      switch (e.data.type) {
        case 'widget:ready':
          stabilityEmitter.emit({
            eventType: 'widget_ready',
            isPartial,
            meta: {
              source: 'receiver'
            }
          })
          setIframeReady(true)
          break
        case 'widget:resize':
          if (typeof e.data.height === 'number' && e.data.height > 0) {
            const newH = Math.min(e.data.height + 2, MAX_IFRAME_HEIGHT)
            stabilityEmitter.emit({
              eventType: 'widget_resize_recv',
              isPartial,
              meta: {
                height: e.data.height,
                clampedHeight: newH,
                first: e.data.first === true,
                locked: heightLockedRef.current
              }
            })
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
          const blocked = Boolean(href && /^\s*(javascript|data)\s*:/i.test(href))
          stabilityEmitter.emit({
            eventType: 'widget_link_open',
            isPartial,
            errorCode: blocked ? 'blocked_protocol' : null,
            meta: {
              href,
              blocked
            }
          })
          if (href && !/^\s*(javascript|data)\s*:/i.test(href)) {
            window.open(href, '_blank', 'noopener,noreferrer')
          }
          break
        }
        case 'widget:error':
          stabilityEmitter.emit({
            eventType: 'widget_error_recv',
            isPartial,
            errorCode: 'receiver_error',
            meta: {
              message: String(e.data.message || 'unknown')
            }
          })
          console.warn('[WidgetRenderer] receiver error:', e.data.message || 'unknown')
          break
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [cacheKey, isPartial, stabilityEmitter])

  const sendUpdate = useCallback((html: string) => {
    const iframe = iframeRef.current
    if (!iframe?.contentWindow) return
    const visual = normalizeVisualWidgetHtml(html)
    if (visual === lastSentRef.current) return
    lastSentRef.current = visual
    iframe.contentWindow.postMessage({ type: 'widget:update', html }, '*')
    stabilityEmitter.emit({
      eventType: 'widget_update_sent',
      isPartial: true,
      meta: {
        htmlLength: html.length
      }
    })
  }, [stabilityEmitter])

  useEffect(() => {
    if (!isPartial || !iframeReady) return
    const sanitized = sanitizeForStreaming(widgetCode)
    finalizedRef.current = false
    setFinalized(false)
    heightLockedRef.current = false
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
    stabilityEmitter.emit({
      eventType: 'widget_finalize_sent',
      isPartial: false,
      meta: {
        htmlLength: sanitized.length
      }
    })
    setFinalized(true)
  }, [isPartial, iframeReady, widgetCode, stabilityEmitter])

  useEffect(() => {
    if (!iframeReady) return

    const pushTheme = () => {
      const nowDark = document.documentElement.classList.contains('dark')
      const vars = resolveThemeVars()
      iframeRef.current?.contentWindow?.postMessage({ type: 'widget:theme', vars, isDark: nowDark }, '*')
      stabilityEmitter.emit({
        eventType: 'widget_theme_sent',
        isPartial,
        meta: {
          isDark: nowDark,
          varCount: Object.keys(vars).length
        }
      })
    }

    pushTheme()
    const observer = new MutationObserver(() => pushTheme())
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [iframeReady, isPartial, stabilityEmitter])

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
