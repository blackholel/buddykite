#!/usr/bin/env node

import { readFileSync } from 'fs'
import { resolve } from 'path'

const projectRoot = process.cwd()
const packageJsonPath = resolve(projectRoot, 'package.json')
const manifestPath = resolve(projectRoot, 'resources/update-manifest.json')

function fail(message) {
  console.error(`[update-manifest] ${message}`)
  process.exit(1)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function parseDistributionMode(manifest) {
  const mode = manifest?.distributionMode
  if (mode === undefined) return 'dual-source'
  if (mode === 'dual-source' || mode === 'github-only') return mode
  fail(`distributionMode must be "dual-source" or "github-only", got ${String(mode)}`)
}

function isHttpUrl(value) {
  if (!isNonEmptyString(value)) {
    return false
  }
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function hasPlaceholder(value) {
  return isNonEmptyString(value) && value.includes('replace-with-real-link')
}

function getPublishRepoFromPackageJson(pkg) {
  const publish = pkg?.build?.publish
  const publishConfig = Array.isArray(publish) ? publish[0] : publish

  if (publishConfig?.provider !== 'github') {
    return null
  }

  if (!isNonEmptyString(publishConfig.owner) || !isNonEmptyString(publishConfig.repo)) {
    return null
  }

  return {
    owner: publishConfig.owner,
    repo: publishConfig.repo
  }
}

let packageJson
let manifest

try {
  packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
} catch (error) {
  fail(`Failed to read package.json: ${String(error)}`)
}

try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
} catch (error) {
  fail(`Failed to read resources/update-manifest.json: ${String(error)}`)
}

if (manifest?.schemaVersion !== 1) {
  fail('schemaVersion must be 1')
}

if (!isNonEmptyString(manifest?.latestVersion)) {
  fail('latestVersion must be a non-empty string')
}

if (!isNonEmptyString(packageJson?.version)) {
  fail('package.json version is missing')
}

const distributionMode = parseDistributionMode(manifest)

if (manifest.latestVersion !== packageJson.version) {
  fail(`latestVersion (${manifest.latestVersion}) must match package.json version (${packageJson.version})`)
}

if (!manifest?.releases || typeof manifest.releases !== 'object') {
  fail('releases must be an object')
}

const release = manifest.releases[manifest.latestVersion]
if (!release || typeof release !== 'object') {
  fail(`releases["${manifest.latestVersion}"] is required`)
}

if (!isNonEmptyString(release.notes)) {
  fail(`releases["${manifest.latestVersion}"].notes is required`)
}

if (!isNonEmptyString(release.publishedAt) || Number.isNaN(Date.parse(release.publishedAt))) {
  fail(`releases["${manifest.latestVersion}"].publishedAt must be a valid ISO date`)
}

if (!release.platforms || typeof release.platforms !== 'object') {
  fail(`releases["${manifest.latestVersion}"].platforms is required`)
}

const requiredPlatforms = ['darwin-arm64', 'win32-x64', 'linux-x64', 'default']
const publishRepo = getPublishRepoFromPackageJson(packageJson)
const expectedGithubTagUrl = publishRepo
  ? `https://github.com/${publishRepo.owner}/${publishRepo.repo}/releases/tag/v${manifest.latestVersion}`
  : null
const requireBaidu = distributionMode !== 'github-only'

for (const platformKey of requiredPlatforms) {
  const platform = release.platforms[platformKey]
  if (!platform || typeof platform !== 'object') {
    fail(`platform "${platformKey}" is required`)
  }

  if (!isHttpUrl(platform.github)) {
    fail(`platform "${platformKey}" github link is required`)
  }

  if (expectedGithubTagUrl && platform.github !== expectedGithubTagUrl) {
    fail(
      `platform "${platformKey}" github link must match ${expectedGithubTagUrl}, got ${platform.github}`
    )
  }

  const baiduUrl = platform.baidu?.url
  const baiduExtractCode = platform.baidu?.extractCode

  if (!requireBaidu) {
    if (baiduUrl !== undefined && baiduUrl !== null && !isHttpUrl(baiduUrl)) {
      fail(`platform "${platformKey}" baidu.url must be a valid http(s) url when provided`)
    }

    if (hasPlaceholder(baiduUrl)) {
      fail(`platform "${platformKey}" baidu.url contains placeholder text`)
    }

    if (baiduUrl && !isNonEmptyString(baiduExtractCode)) {
      fail(`platform "${platformKey}" baidu.extractCode is required when baidu.url is provided`)
    }

    continue
  }

  if (!isHttpUrl(baiduUrl)) {
    fail(`platform "${platformKey}" baidu.url is required in dual-source mode`)
  }

  if (hasPlaceholder(baiduUrl)) {
    fail(`platform "${platformKey}" baidu.url contains placeholder text`)
  }

  if (!isNonEmptyString(baiduExtractCode)) {
    fail(`platform "${platformKey}" baidu.extractCode is required`)
  }
}

console.log('[update-manifest] Validation passed')
