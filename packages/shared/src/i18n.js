// Shared dictionaries (locales/) and the lookup function. Each app picks its language itself.
import uk from './locales/uk'
import en from './locales/en'

export const dicts = { uk, en }

/** Default language before the user picks one: the system language if we have it, otherwise English. */
export function systemLang() {
  const l = (typeof navigator !== 'undefined' && navigator.language) || ''
  return /^uk\b/i.test(l) ? 'uk' : 'en'
}

/** Text by key: language → English → Ukrainian → the key itself. {name} placeholders come from params. */
export function translate(lang, key, params) {
  let v = (dicts[lang] && dicts[lang][key]) ?? en[key] ?? uk[key] ?? key
  if (params) v = v.replace(/\{(\w+)\}/g, (_, k) => (params[k] ?? ''))
  return v
}
