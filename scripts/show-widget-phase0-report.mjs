#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const args = { log: '', round: '' }
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (item === '--log') {
      args.log = argv[i + 1] || ''
      i += 1
      continue
    }
    if (item === '--round') {
      args.round = argv[i + 1] || ''
      i += 1
      continue
    }
  }
  return args
}

function extractEvent(line) {
  const marker = '[telemetry] widget_stability'
  const idx = line.indexOf(marker)
  if (idx < 0) return null
  const raw = line.slice(idx + marker.length).trim()
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function ratio(num, den) {
  if (!den) return 0
  return Number((num / den).toFixed(4))
}

function buildMetrics(events) {
  const validEvents = events.filter((event) => typeof event.runId === 'string' && event.runId.trim().length > 0)

  const byInstance = new Map()
  for (const event of validEvents) {
    const instanceId = typeof event.instanceId === 'string' ? event.instanceId : 'unknown'
    if (!byInstance.has(instanceId)) {
      byInstance.set(instanceId, {
        hasReady: false,
        hasFinalize: false,
        hasError: false,
        hasTheme: false,
        hasFirstResize: false,
        firstResizeCount: 0
      })
    }
    const state = byInstance.get(instanceId)
    switch (event.eventType) {
      case 'widget_ready':
        state.hasReady = true
        break
      case 'widget_finalize_sent':
        state.hasFinalize = true
        break
      case 'widget_error_recv':
        state.hasError = true
        break
      case 'widget_theme_sent':
        state.hasTheme = true
        break
      case 'widget_resize_recv':
        if (event.meta && event.meta.first === true) {
          state.hasFirstResize = true
          state.firstResizeCount += 1
        }
        break
      default:
        break
    }
  }

  const instances = Array.from(byInstance.values())
  const readyInstances = instances.filter((item) => item.hasReady).length
  const finalizeInstances = instances.filter((item) => item.hasFinalize).length
  const errorInstances = instances.filter((item) => item.hasError).length
  const themeInstances = instances.filter((item) => item.hasTheme).length
  const firstResizeInstances = instances.filter((item) => item.hasFirstResize).length
  const flickerIncidentCount = instances.filter((item) => item.firstResizeCount > 1).length

  const parseableCoverage = ratio(validEvents.length, events.length)

  return {
    total_events: events.length,
    valid_events: validEvents.length,
    parseable_coverage: parseableCoverage,
    total_instances: instances.length,
    finalize_success_rate: ratio(finalizeInstances, readyInstances || instances.length),
    widget_error_rate: ratio(errorInstances, readyInstances || instances.length),
    first_resize_success_rate: ratio(firstResizeInstances, readyInstances || instances.length),
    theme_sync_success_rate: ratio(themeInstances, readyInstances || instances.length),
    flicker_incident_count: flickerIncidentCount
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.log) {
    console.error('Usage: node scripts/show-widget-phase0-report.mjs --log <telemetry.log> [--round Round1]')
    process.exit(1)
  }

  const resolved = path.resolve(args.log)
  if (!fs.existsSync(resolved)) {
    console.error(`Log file not found: ${resolved}`)
    process.exit(1)
  }

  const content = fs.readFileSync(resolved, 'utf8')
  const events = content
    .split(/\r?\n/)
    .map((line) => extractEvent(line))
    .filter(Boolean)

  const report = {
    round: args.round || null,
    log_file: resolved,
    generated_at: new Date().toISOString(),
    metrics: buildMetrics(events)
  }

  console.log(JSON.stringify(report, null, 2))
}

main()

