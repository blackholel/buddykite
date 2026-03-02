export const SUPPORTED_LOCALES = {
  de: 'Deutsch',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  ja: '日本語',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文'
} as const

export type LocaleCode = keyof typeof SUPPORTED_LOCALES

export function isLocaleCode(value: unknown): value is LocaleCode {
  return typeof value === 'string' && value in SUPPORTED_LOCALES
}

export function normalizeLocale(input: unknown, fallback: LocaleCode = 'en'): LocaleCode {
  if (isLocaleCode(input)) {
    return input
  }
  return fallback
}
