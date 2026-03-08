/**
 * MarkdownRenderer - Unified markdown rendering for chat/canvas/modals.
 *
 * Capabilities aligned with TOKENICODE:
 * - GFM + raw HTML (sanitized)
 * - Syntax highlighting with highlight.js
 * - File-path smart chips for inline code and bare path text
 * - Relative/local image path resolution via kite-file://
 * - Link handling through app APIs
 */

import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { Check, Copy, ExternalLink, FileCode2 } from 'lucide-react'
import { join, normalize } from 'path-browserify'
import { useTranslation } from '../../i18n'
import { hljs } from '../../lib/highlight-loader'
import { api } from '../../api'
import { ResourceSuggestionCard, parseResourceSuggestion } from '../skills/SkillSuggestionCard'

interface MarkdownRendererProps {
  content: string
  className?: string
  workDir?: string
  basePath?: string
}

interface MarkdownImageProps {
  src?: string
  alt?: string
  basePath?: string
}

interface CodeBlockProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode
  workDir?: string
  basePath?: string
  onOpenFilePath?: (filePath: string) => void
}

const KNOWN_FILE_EXTENSIONS = new Set([
  'md', 'mdx', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'jsonl',
  'toml', 'yaml', 'yml', 'py', 'pyi', 'rs', 'go', 'html', 'htm', 'css',
  'scss', 'sass', 'less', 'vue', 'svelte', 'sh', 'bash', 'zsh', 'fish',
  'env', 'conf', 'cfg', 'ini', 'xml', 'sql', 'graphql', 'gql', 'proto',
  'lock', 'log', 'txt', 'csv', 'rb', 'php', 'java', 'kt', 'swift', 'c',
  'cpp', 'h', 'hpp', 'cs', 'r', 'lua', 'zig', 'ex', 'exs', 'erl', 'ml',
  'mli', 'tf', 'hcl', 'dockerfile', 'makefile', 'png', 'jpg', 'jpeg',
  'gif', 'svg', 'webp', 'ico', 'wasm', 'map'
])

const KNOWN_EXT_RE = /^[\w][\w.-]*\.(?:md|mdx|ts|tsx|js|jsx|mjs|cjs|json|jsonl|toml|yaml|yml|py|pyi|rs|go|html|htm|css|scss|sass|less|vue|svelte|sh|bash|zsh|fish|env|conf|cfg|ini|xml|sql|graphql|gql|proto|lock|log|txt|csv|rb|php|java|kt|swift|c|cpp|h|hpp|cs|r|lua|zig|ex|exs|erl|ml|mli|tf|hcl|dockerfile|makefile)$/i
const FILE_PATH_RE = /^(?:\/|\.\/|\.\.\/|[a-zA-Z]:[/\\]|src\/|lib\/|components\/|stores\/|hooks\/|utils\/|tests\/|__tests__\/)[\w.@/\\-]+\.\w{1,10}$/

const BARE_PATH_RE = /(^|[^`\w:@#/])((?:(?:\/|\.\.?\/)[\w.@/+-]+\.\w{1,10}|(?:src|lib|components|stores|hooks|utils|tests|__tests__|app|pages|public|assets|styles|config)\/[\w.@/+-]+\.\w{1,10}))(?![`\w])/g

const SANITIZE_SCHEMA: any = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), 'details', 'summary', 'kbd', 'mark'],
  attributes: {
    ...(defaultSchema.attributes || {}),
    '*': [
      ...((((defaultSchema.attributes as Record<string, unknown>) || {})['*'] as Array<string | RegExp>) || []),
      'className'
    ]
  }
}

const REMARK_PLUGINS = [remarkGfm]
const REHYPE_PLUGINS: any[] = [
  rehypeRaw,
  [rehypeSanitize, SANITIZE_SCHEMA],
  [rehypeHighlight, { hljs }]
]

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function isDataUrl(value: string): boolean {
  return /^data:/i.test(value)
}

function isMailToUrl(value: string): boolean {
  return /^(mailto:|tel:)/i.test(value)
}

function isFileUrl(value: string): boolean {
  return /^file:\/\//i.test(value)
}

function isKiteFileUrl(value: string): boolean {
  return /^kite-file:\/\//i.test(value)
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[/\\]/.test(value)
}

function isPosixAbsolutePath(value: string): boolean {
  return value.startsWith('/')
}

function isAbsoluteFilePath(value: string): boolean {
  return isWindowsAbsolutePath(value) || isPosixAbsolutePath(value)
}

function normalizeFilesystemPath(filePath: string): string {
  return normalize(filePath).replace(/\\/g, '/')
}

function resolveFilePath(filePath: string, basePath?: string): string {
  const trimmed = filePath.trim()
  if (!trimmed) return trimmed

  if (isFileUrl(trimmed)) {
    return normalizeFilesystemPath(decodeURIComponent(trimmed.replace(/^file:\/\//i, '')))
  }

  if (isAbsoluteFilePath(trimmed)) {
    return normalizeFilesystemPath(trimmed)
  }

  if (!basePath) {
    return normalizeFilesystemPath(trimmed)
  }

  return normalizeFilesystemPath(join(basePath, trimmed))
}

function toKiteFileUrl(filePath: string): string {
  return `kite-file://${encodeURI(normalizeFilesystemPath(filePath))}`
}

function fromKiteFileUrl(url: string): string {
  return decodeURIComponent(url.replace(/^kite-file:\/\//i, ''))
}

function resolveMarkdownResourceUrl(rawSrc: string, basePath?: string): string {
  const src = rawSrc.trim()
  if (!src) return src

  if (isHttpUrl(src) || isDataUrl(src) || isKiteFileUrl(src) || isMailToUrl(src)) {
    return src
  }

  if (isFileUrl(src) || isAbsoluteFilePath(src) || basePath) {
    return toKiteFileUrl(resolveFilePath(src, basePath))
  }

  return src
}

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return extractText((node as any).props.children)
  }
  return ''
}

function getFileName(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  if (idx < 0) return normalized
  return normalized.slice(idx + 1)
}

function resolveInlineFilePath(text: string, basePath?: string): { absolutePath: string; fileName: string } | null {
  const candidate = text.trim().replace(/^['"`]|['"`]$/g, '')
  if (!candidate || candidate.includes('\n') || /\s/.test(candidate)) return null

  const ext = candidate.split('.').pop()?.toLowerCase() ?? ''
  const isKnownExt = KNOWN_FILE_EXTENSIONS.has(ext)
  if (!isKnownExt) return null

  if (!FILE_PATH_RE.test(candidate) && !KNOWN_EXT_RE.test(candidate)) {
    return null
  }

  const absolutePath = resolveFilePath(candidate, basePath)
  return {
    absolutePath,
    fileName: getFileName(candidate)
  }
}

function wrapBareFilePaths(content: string): string {
  const fenced = content.split(/(```[\s\S]*?```)/g)

  return fenced.map((part, i) => {
    if (i % 2 === 1) return part

    const inlined = part.split(/(`[^`\n]+`)/g)
    return inlined.map((segment, j) => {
      if (j % 2 === 1) return segment

      return segment.replace(BARE_PATH_RE, (match, prefix, path, offset, full) => {
        const pathStart = offset + prefix.length

        if (pathStart > 0 && full[pathStart - 1] === '(') return match
        const before = full.slice(Math.max(0, pathStart - 2), pathStart)
        if (before.endsWith('](')) return match

        const ext = path.split('.').pop()?.toLowerCase()
        if (!ext || !KNOWN_FILE_EXTENSIONS.has(ext)) return match

        return `${prefix}\`${path}\``
      })
    }).join('')
  }).join('')
}

function MarkdownImage({ src, alt, basePath }: MarkdownImageProps) {
  const { t } = useTranslation()
  const [loadFailed, setLoadFailed] = useState(false)

  const resolvedSrc = useMemo(() => {
    if (!src) return ''
    return resolveMarkdownResourceUrl(src, basePath)
  }, [src, basePath])

  const handleClick = useCallback(async () => {
    if (!resolvedSrc) return

    try {
      if (isKiteFileUrl(resolvedSrc)) {
        await api.openArtifact(fromKiteFileUrl(resolvedSrc))
        return
      }

      if (isHttpUrl(resolvedSrc) || isMailToUrl(resolvedSrc)) {
        await api.openExternal(resolvedSrc)
      }
    } catch (error) {
      console.warn('[MarkdownRenderer] Failed to open image:', error)
    }
  }, [resolvedSrc])

  if (!resolvedSrc) return null

  if (loadFailed) {
    return (
      <div className="my-3 rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        {t('Unable to load image')}
      </div>
    )
  }

  return (
    <figure className="my-3 rounded-xl overflow-hidden border border-border/60 bg-card/70 inline-block max-w-full">
      <img
        src={resolvedSrc}
        alt={alt || ''}
        loading="lazy"
        className="max-w-full max-h-[28rem] object-contain cursor-zoom-in"
        onClick={handleClick}
        onError={() => setLoadFailed(true)}
      />
      {alt ? (
        <figcaption className="px-3 py-2 text-xs text-muted-foreground border-t border-border/60">
          {alt}
        </figcaption>
      ) : null}
    </figure>
  )
}

function CodeBlock({ children, className, workDir, basePath, onOpenFilePath, ...props }: CodeBlockProps) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const codeRef = useRef<HTMLElement>(null)

  const effectiveBasePath = basePath || workDir
  const match = /language-([a-zA-Z0-9_+-]+)/.exec(className || '')
  const language = match ? match[1] : ''

  const rawContent = useMemo(() => extractText(children), [children])
  const inlineFileInfo = useMemo(() => {
    if (className) return null
    return resolveInlineFilePath(rawContent, effectiveBasePath)
  }, [className, rawContent, effectiveBasePath])

  const resourceSuggestion = useMemo(() => {
    if (!workDir || !rawContent) return null

    const normalizedLanguage = language.toLowerCase()
    if (normalizedLanguage && normalizedLanguage !== 'json' && normalizedLanguage !== 'jsonc') {
      return null
    }

    return parseResourceSuggestion(rawContent)
  }, [workDir, rawContent, language])

  const handleCopy = useCallback(async () => {
    const text = codeRef.current?.textContent || ''
    await navigator.clipboard.writeText(text.replace(/\n$/, ''))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [])

  if (!className) {
    if (inlineFileInfo) {
      return (
        <button
          type="button"
          data-md-file-chip="true"
          title={inlineFileInfo.absolutePath}
          onClick={() => onOpenFilePath?.(inlineFileInfo.absolutePath)}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-0.5 rounded-md
            bg-primary/10 border border-primary/25 text-primary text-xs font-medium
            hover:bg-primary/15 hover:border-primary/35 transition-colors align-baseline"
          {...props}
        >
          <FileCode2 size={12} />
          <span className="max-w-[18rem] truncate">{inlineFileInfo.fileName}</span>
        </button>
      )
    }

    return (
      <code
        className="px-1.5 py-0.5 mx-0.5 bg-secondary/80 text-primary rounded text-[0.9em] font-mono"
        {...props}
      >
        {children}
      </code>
    )
  }

  if (resourceSuggestion && workDir) {
    return <ResourceSuggestionCard suggestion={resourceSuggestion} workDir={workDir} />
  }

  return (
    <div className="group relative my-3 rounded-xl overflow-hidden border border-border/50 bg-secondary/35">
      <div className="flex items-center justify-between px-4 py-2 bg-secondary/55 border-b border-border/40">
        <span className="text-[11px] text-muted-foreground/90 font-mono uppercase tracking-wide">
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground/70
            hover:text-foreground hover:bg-background/50 rounded-md transition-colors"
          title={t('Copy code')}
        >
          {copied ? (
            <>
              <Check size={14} className="text-green-500" />
              <span className="text-green-500">{t('Copied')}</span>
            </>
          ) : (
            <>
              <Copy size={14} />
              <span>{t('Copy')}</span>
            </>
          )}
        </button>
      </div>

      <pre className="p-4 overflow-x-auto">
        <code ref={codeRef} className={`${className} text-sm font-mono leading-relaxed`} {...props}>
          {children}
        </code>
      </pre>
    </div>
  )
}

function createComponents(options: {
  workDir?: string
  basePath?: string
  onOpenFilePath: (filePath: string) => void
}) {
  const { workDir, onOpenFilePath } = options
  const effectiveBasePath = options.basePath || workDir

  return {
    code: (props: CodeBlockProps) => (
      <CodeBlock
        {...props}
        workDir={workDir}
        basePath={effectiveBasePath}
        onOpenFilePath={onOpenFilePath}
      />
    ),

    p: ({ children }: { children?: React.ReactNode }) => (
      <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>
    ),

    h1: ({ children }: { children?: React.ReactNode }) => (
      <h1 className="text-xl font-semibold mt-6 mb-3 first:mt-0">{children}</h1>
    ),
    h2: ({ children }: { children?: React.ReactNode }) => (
      <h2 className="text-lg font-semibold mt-5 mb-2 first:mt-0">{children}</h2>
    ),
    h3: ({ children }: { children?: React.ReactNode }) => (
      <h3 className="text-base font-semibold mt-4 mb-2 first:mt-0">{children}</h3>
    ),

    ul: ({ children }: { children?: React.ReactNode }) => (
      <ul className="mb-3 pl-5 space-y-1 list-disc marker:text-muted-foreground/60">{children}</ul>
    ),
    ol: ({ children }: { children?: React.ReactNode }) => (
      <ol className="mb-3 pl-5 space-y-1 list-decimal marker:text-muted-foreground/60">{children}</ol>
    ),
    li: ({ children }: { children?: React.ReactNode }) => (
      <li className="leading-relaxed">{children}</li>
    ),

    blockquote: ({ children }: { children?: React.ReactNode }) => (
      <blockquote className="my-3 pl-4 border-l-2 border-primary/35 text-muted-foreground">
        {children}
      </blockquote>
    ),

    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const handleOpen = async (event: React.MouseEvent<HTMLAnchorElement>) => {
        if (!href || href.startsWith('#')) return

        event.preventDefault()

        try {
          if (isHttpUrl(href) || isMailToUrl(href)) {
            await api.openExternal(href)
            return
          }

          if (isKiteFileUrl(href)) {
            await api.openArtifact(fromKiteFileUrl(href))
            return
          }

          if (isFileUrl(href) || isAbsoluteFilePath(href) || effectiveBasePath) {
            await api.openArtifact(resolveFilePath(href, effectiveBasePath))
            return
          }

          await api.openExternal(href)
        } catch (error) {
          console.warn('[MarkdownRenderer] Failed to open link:', error)
        }
      }

      return (
        <a
          href={href}
          onClick={handleOpen}
          className="inline-flex items-center gap-1 text-primary hover:underline underline-offset-2"
          title={href}
        >
          {children}
          {href && isHttpUrl(href) ? <ExternalLink size={12} className="opacity-70" /> : null}
        </a>
      )
    },

    img: ({ src, alt }: { src?: string; alt?: string }) => (
      <MarkdownImage src={src} alt={alt} basePath={effectiveBasePath} />
    ),

    table: ({ children }: { children?: React.ReactNode }) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-border/50">
        <table className="w-full text-sm">{children}</table>
      </div>
    ),
    thead: ({ children }: { children?: React.ReactNode }) => (
      <thead className="bg-secondary/50">{children}</thead>
    ),
    th: ({ children }: { children?: React.ReactNode }) => (
      <th className="px-3 py-2 text-left font-medium border-b border-border/60">{children}</th>
    ),
    td: ({ children }: { children?: React.ReactNode }) => (
      <td className="px-3 py-2 border-b border-border/40">{children}</td>
    ),

    hr: () => <hr className="my-6 border-border/60" />,

    strong: ({ children }: { children?: React.ReactNode }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    em: ({ children }: { children?: React.ReactNode }) => (
      <em className="italic">{children}</em>
    ),
    del: ({ children }: { children?: React.ReactNode }) => (
      <del className="text-muted-foreground line-through">{children}</del>
    ),

    input: ({ checked, ...props }: React.InputHTMLAttributes<HTMLInputElement>) => (
      <input
        type="checkbox"
        checked={checked}
        readOnly
        className="mr-2 rounded border-muted-foreground/30 text-primary"
        {...props}
      />
    )
  }
}

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  className = '',
  workDir,
  basePath
}: MarkdownRendererProps) {
  const effectiveBasePath = basePath || workDir

  const handleOpenFilePath = useCallback(async (filePath: string) => {
    try {
      await api.openArtifact(filePath)
    } catch (error) {
      console.warn('[MarkdownRenderer] Failed to open file path:', error)
    }
  }, [])

  const components = useMemo(
    () => createComponents({ workDir, basePath: effectiveBasePath, onOpenFilePath: handleOpenFilePath }),
    [effectiveBasePath, handleOpenFilePath, workDir]
  )

  const processedContent = useMemo(() => wrapBareFilePaths(content), [content])

  const suggestionFromMarkdown = useMemo(() => {
    if (!workDir) return null
    const trimmed = content.trim()
    if (!trimmed) return null

    const hasFence = /```/.test(trimmed)
    const isSingleFence = /^```(?:json|jsonc)?\s*[\s\S]*?```\s*$/i.test(trimmed)
    if (hasFence && !isSingleFence) return null

    return parseResourceSuggestion(trimmed)
  }, [content, workDir])

  if (!content) return null

  if (suggestionFromMarkdown && workDir) {
    return <ResourceSuggestionCard suggestion={suggestionFromMarkdown} workDir={workDir} />
  }

  return (
    <div className={`markdown-content ${className}`}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={components as any}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
})
