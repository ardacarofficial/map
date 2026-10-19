# Locale resources

All visible strings go through `t(key, params)`. Turkish (`tr`) is primary;
built-in Turkish and English resources must have exactly the same keys and
argument names. Messages use ICU syntax, formatted by locally bundled
[`intl-messageformat`](https://formatjs.github.io/docs/intl-messageformat/).
No translations are fetched over the network. Text is always text (`ignoreTag:
true`), never HTML.

## Contributing keys

Add keys to your own feature file in **both** `locales/tr/<feature>.json` and
`locales/en/<feature>.json`. The filename supplies the first key segment;
`{"saved": "Kaydedildi"}` in `palettes.json` is `t("palettes.saved")`.
Existing dotted names inside a feature file (for example command ids) are valid.

Run `pnpm i18n:gen` from the repo root and commit `messages.generated.ts`.
Tests reject stale generation, malformed ICU, empty messages, missing built-in
keys and mismatched argument names. Generated `MessageKey` checks call-site
keys; `MessageArguments<Key>` is available for stricter new argument types.
The compatible `t(key, params): string` facade still accepts string/number values.
Pass raw numeric counts; ICU handles localized number display. Numeric strings
such as `"1000"` work too. Do not pass preformatted `"1.000"`/`"1,000"` counts.

Use ICU plurals, for example:

```json
{"count": "{count, plural, one {# stamp} other {# stamps}}"}
```

Turkish counted nouns remain bare (`# hücre`). Use all plural categories needed
by the target language, and always include `other`. Quote literal ICU braces
with apostrophes (`'{'` / `'}'`); double a literal apostrophe (`''`). Argument
values are never reparsed, so names containing braces/apostrophes are safe.

## Adding a language

Drop a folder under `locales/<BCP-47-id>/` and rebuild. Include `meta.json`:

```json
{"id": "de", "nativeName": "Deutsch", "fallback": "tr"}
```

Copy feature JSON files from a built-in language and translate them. Discovery
uses `import.meta.glob`; no locale enum, settings whitelist or picker code needs
editing. `availableLocales()` exposes `id`, `nativeName`, `fallback` and
`completeness` (0–1, translated valid keys only). The Settings language control
uses native names. Its draft previews immediately; cancel restores the previous
language, and Save persists the selected id through the existing settings queue.
Old `locale: "tr"` / `"en"` settings continue to work.

Partial optional locales use their metadata fallback, then Turkish. Invalid
JSON, metadata, ICU or placeholder names are diagnosed locally and ignored;
missing keys fall back per message with a deduplicated diagnostic. Unknown
saved locale ids follow the existing settings validation path. Translation
format errors return a fallback or the key rather than crashing the UI.

Installed desktop runtime locale import is deferred. Copying files next to a
packaged bundle does **not** add a language; add the source folder and rebuild.
The partial Polish fixture (`pl-x-i18n`) under `__fixtures__/locales` proves automatic
discovery and multiple plural forms, and includes intentionally malformed JSON
to verify raw imports isolate optional-file errors. Fixtures are excluded from
production resources.

## Migrating keys from parallel lanes

The old TS catalogs are removed. To migrate additive legacy keys after merging
another lane, run from `packages/editor`:

```sh
pnpm i18n:migrate --ref <revision-containing-tr.ts-and-en.ts>
pnpm i18n:gen
```

Without `--ref`, the converter reads restored local `src/i18n/tr.ts` / `en.ts`.
It transpiles trusted repository catalogs, quotes ICU literals, introduces count
plurals and only adds missing entries. Existing ICU translations win. Review
singular sentence grammar and remove the restored TS files afterwards.
`__fixtures__/migration.expected.json` freezes the original rendered output of
every baseline key at sample value 2; singular wording changes have separate
tests. Direct `setLocale()` updates notify subscribers, refresh the existing
app-settings root revision, and request a canvas frame without remounting it.

Acceptance impact: accept4 `v05` language persistence keeps its existing settings
JSON and command selectors. Settings language selection now previews before
Save; Cancel restores the previous locale. No desktop host/file format changes.
