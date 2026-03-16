/**
 * TokenUsageIndicator - Displays token usage in a subtle, non-intrusive way
 *
 * Design principles:
 * - Minimal by default: shows only "12K" in muted color
 * - Hover reveals details: full usage breakdown in tooltip
 * - Independent component: can be placed anywhere
 * - Mobile-friendly: tap to see details on touch devices
 */

import { useState } from 'react'
import type { TokenUsage } from '../../types'
import { useTranslation } from '../../i18n'

interface TokenUsageIndicatorProps {
  tokenUsage: TokenUsage
  previousCost?: number  // Previous cumulative cost, used to calculate current message cost
  className?: string
  variant?: 'minimal' | 'footer'
}

// Format number to K format (e.g., 12345 -> "12K")
function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString()
  if (tokens < 10000) return `${(tokens / 1000).toFixed(1)}K`
  return `${Math.round(tokens / 1000)}K`
}

// Format cost to USD (e.g., 0.0123 -> "$0.01")
function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  return `$${cost.toFixed(2)}`
}

export function TokenUsageIndicator({
  tokenUsage,
  previousCost = 0,
  className = '',
  variant = 'minimal'
}: TokenUsageIndicatorProps) {
  const { t } = useTranslation()
  const [showTooltip, setShowTooltip] = useState(false)

  // Current context size = all input tokens (consistent with CC's /context formula)
  // inputTokens: new input tokens (not cached)
  // cacheReadTokens: historical context read from cache
  // cacheCreationTokens: tokens for newly created cache
  // outputTokens: output tokens (also count towards context)
  const contextUsed = tokenUsage.inputTokens + tokenUsage.cacheReadTokens +
                      tokenUsage.cacheCreationTokens + tokenUsage.outputTokens
  const hasTokenBreakdown =
    tokenUsage.inputTokens > 0 ||
    tokenUsage.outputTokens > 0 ||
    tokenUsage.cacheReadTokens > 0 ||
    tokenUsage.cacheCreationTokens > 0

  // Defensive: avoid NaN when contextWindow is 0
  const contextWindow = tokenUsage.contextWindow > 0 ? tokenUsage.contextWindow : 200000
  const usagePercent = Math.round((contextUsed / contextWindow) * 100)

  // Calculate current message cost
  const currentCost = tokenUsage.totalCostUsd - previousCost

  return (
    <div
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={() => setShowTooltip(!showTooltip)}
    >
      {/* Display text */}
      {variant === 'footer' ? (
        <span className="text-[11px] text-muted-foreground/65 cursor-default select-none whitespace-nowrap">
          {t('Token usage')} · {hasTokenBreakdown ? contextUsed.toLocaleString() : '--'}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground/50 cursor-default select-none">
          {hasTokenBreakdown ? formatTokens(contextUsed) : '--'}
        </span>
      )}

      {/* Tooltip - shows on hover/tap */}
      {showTooltip && (
        <div className={`absolute bottom-full mb-2 z-50 animate-fade-in ${variant === 'footer' ? 'left-0' : 'right-0'}`}>
          <div className="bg-popover border border-border rounded-lg shadow-lg p-3 min-w-[180px]">
            {/* Header */}
            <div className="text-xs font-medium text-foreground mb-2">
              {t('Token usage')}
            </div>

            {/* Progress bar */}
            <div className="h-1.5 bg-secondary rounded-full mb-2 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  usagePercent >= 95
                    ? 'bg-red-500'
                    : usagePercent >= 80
                      ? 'bg-amber-500'
                      : 'bg-primary/60'
                }`}
                style={{ width: `${hasTokenBreakdown ? Math.min(usagePercent, 100) : 0}%` }}
              />
            </div>

            {/* Usage stats */}
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>{t('Used / limit')}</span>
                <span className="text-foreground">
                  {hasTokenBreakdown ? `${formatTokens(contextUsed)} / ${formatTokens(contextWindow)}` : '-- / --'}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{t('Input')}</span>
                <span>{hasTokenBreakdown ? formatTokens(tokenUsage.inputTokens) : '--'}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{t('Output')}</span>
                <span>{hasTokenBreakdown ? formatTokens(tokenUsage.outputTokens) : '--'}</span>
              </div>
              {hasTokenBreakdown && tokenUsage.cacheReadTokens > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>{t('Cache read')}</span>
                  <span>{formatTokens(tokenUsage.cacheReadTokens)}</span>
                </div>
              )}
              {tokenUsage.totalCostUsd > 0 && (
                <div className="flex justify-between text-muted-foreground pt-1 border-t border-border/50">
                  <span>{t('Current / total')}</span>
                  <span className="text-foreground">
                    {formatCost(currentCost)}/{formatCost(tokenUsage.totalCostUsd)}
                  </span>
                </div>
              )}
            </div>

            {/* Warning if near limit */}
            {hasTokenBreakdown && usagePercent >= 80 && (
              <div className={`mt-2 pt-2 border-t border-border/50 text-xs ${
                usagePercent >= 95 ? 'text-red-500' : 'text-amber-500'
              }`}>
                {usagePercent >= 95
                  ? t('Context will be automatically compressed soon')
                  : t('Approaching context limit')
                }
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
