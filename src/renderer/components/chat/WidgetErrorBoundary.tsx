import React from 'react'

interface WidgetErrorBoundaryProps {
  children: React.ReactNode
  fallbackTitle?: string
  fallbackDetail?: string
}

interface WidgetErrorBoundaryState {
  hasError: boolean
}

export class WidgetErrorBoundary extends React.Component<WidgetErrorBoundaryProps, WidgetErrorBoundaryState> {
  constructor(props: WidgetErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): WidgetErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.warn('[WidgetErrorBoundary] widget render failed', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <div className="font-medium">{this.props.fallbackTitle || 'Widget failed to render'}</div>
          <div className="text-xs opacity-80 mt-1">{this.props.fallbackDetail || 'Widget render error'}</div>
        </div>
      )
    }

    return this.props.children
  }
}
