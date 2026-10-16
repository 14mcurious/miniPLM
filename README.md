# Mini PLM

Mini PLM is a React single-page application with:

- a **Home** page (`/`) with the entry points to the two areas
- an **Administration** area (`/administration`)
- a **Work Area** (`/work-area`)

## Internationalization

All UI texts, titles, labels, descriptions and error messages are resolved
through a key-value translation layer (`src/i18n`):

- default language: English (`src/i18n/translations/en.json`)
- additional catalogs live next to it (e.g. `it.json` for Italian)

To add a language: create a flat key/value JSON file in
`src/i18n/translations` with the same key set and register it in the
`translations` map of `src/i18n/i18n.ts`. Keys missing from a catalog fall
back to English; unknown keys are shown as-is. The active language is
selectable from the top-right switcher and is persisted in the browser.
