/**
 * KiteLogo - Brand animated logo component
 * Used across the app for loading states and branding
 *
 * Usage:
 *   <KiteLogo size="sm" />      // 28px - for inline/small areas
 *   <KiteLogo size="md" />      // 48px - for medium contexts
 *   <KiteLogo size="lg" />      // 96px - for large displays (like splash)
 *   <KiteLogo size={64} />      // custom size in pixels
 *   <KiteLogo animated={false} /> // static icon (for calm contexts)
 */

interface KiteLogoProps {
  /** Size preset or custom pixel value */
  size?: 'sm' | 'md' | 'lg' | number
  /** Optional additional class names */
  className?: string
  /** Whether to run breathing animations */
  animated?: boolean
}

interface KiteGlyphProps {
  size?: number
  className?: string
  strokeWidth?: number
}

// Size presets in pixels
const SIZE_PRESETS = {
  sm: 28,
  md: 48,
  lg: 96
} as const

export function KiteGlyph({ size = 24, className = '', strokeWidth = 2.5 }: KiteGlyphProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d="M16 20L42 12L52 32L26 42L16 20Z" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16 20L52 32" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M42 12L26 42" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M31 16L38 38" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M26 42C22 50 16 56 9 59" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M26 42C24 51 19 58 14 63" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
      <path d="M26 42C35 51 44 58 58 64" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  )
}

function getScaledStyles(size: number) {
  return {
    outerRadius: size <= 32 ? 11 : size <= 56 ? 15 : 21,
    shellInset: size <= 32 ? 2 : size <= 56 ? 4 : 8,
    tileInset: size <= 32 ? 6 : size <= 56 ? 10 : 18,
    tileRadius: size <= 32 ? 8 : size <= 56 ? 12 : 20,
    glyphSize: size <= 32 ? 14 : size <= 56 ? 22 : 42,
    glyphStroke: size <= 32 ? 2.6 : size <= 56 ? 2.4 : 2.2
  }
}

export function KiteLogo({ size = 'md', className = '', animated = true }: KiteLogoProps): JSX.Element {
  const pixelSize = typeof size === 'number' ? size : SIZE_PRESETS[size]
  const styles = getScaledStyles(pixelSize)
  const outerRadius = `${styles.outerRadius}px`
  const tileRadius = `${styles.tileRadius}px`

  return (
    <div className={`relative ${className}`} style={{ width: pixelSize, height: pixelSize }}>
      <div
        className={`relative w-full h-full overflow-hidden ${animated ? 'kite-breathe' : ''}`}
        style={{ borderRadius: outerRadius }}
      >
        <div
          className="absolute inset-0"
          style={{
            borderRadius: outerRadius,
            background: 'linear-gradient(135deg, #3b2a1c 0%, #2f3428 52%, #513a1f 100%)'
          }}
        />

        <div
          className="absolute"
          style={{
            inset: styles.shellInset,
            borderRadius: outerRadius,
            background: 'radial-gradient(circle at 50% 35%, rgba(255,255,255,0.16), rgba(255,255,255,0) 70%)'
          }}
        />

        <div
          className="absolute border flex items-center justify-center"
          style={{
            inset: styles.tileInset,
            borderRadius: tileRadius,
            backgroundColor: '#f6f7f9',
            borderColor: '#d8dee8',
            boxShadow: '0 8px 24px rgba(15, 23, 42, 0.22)'
          }}
        >
          <KiteGlyph
            size={styles.glyphSize}
            strokeWidth={styles.glyphStroke}
            className="text-[#1d62d8]"
          />
        </div>
      </div>
    </div>
  )
}
