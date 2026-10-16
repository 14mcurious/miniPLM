import en from "./translations/en.json";
import it from "./translations/it.json";

/**
 * Key-value translation catalogs.
 *
 * To add a language:
 *   1. create a flat key/value JSON file in ./translations (same shape as
 *      en.json, e.g. fr.json) with your own translations;
 *   2. register it in the `translations` map below.
 *
 * Keys missing from a catalog fall back to the default language
 * (English). Unknown keys are returned as-is, so a missing translation
 * is visible instead of silent.
 */
export const translations: Record<string, Record<string, string>> = {
  en,
  it,
};

export const DEFAULT_LANGUAGE = "en";
export const AVAILABLE_LANGUAGES = Object.keys(translations);

/**
 * Translate a key in the given language.
 * `vars` substitutes `{name}` placeholders, e.g.
 * translate("en", "error.httpStatus", { status: 500 }).
 */
export function translate(
  language: string,
  key: string,
  vars?: Record<string, string | number>
): string {
  const catalog = translations[language] ?? translations[DEFAULT_LANGUAGE];
  const fallback = translations[DEFAULT_LANGUAGE];
  const raw =
    key in catalog ? catalog[key] : key in fallback ? fallback[key] : key;
  if (!vars) return raw;
  return Object.entries(vars).reduce(
    (text, [name, value]) =>
      text.split(`{${name}}`).join(String(value)),
    raw
  );
}
