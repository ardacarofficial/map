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

The old TS catalogs are removed. If a later lane (for example Godot export)
leaves trusted legacy catalogs, run this **one command from the repo root**:

```sh
pnpm i18n:import-legacy <path/to/tr.ts> <path/to/en.ts>
```

Paths are relative to the current working directory (absolute paths also work).
The command imports missing keys into feature JSON files and regenerates the
key/argument schema. It does not delete the input files, any existing resource
keys, unrelated feature files, or locale metadata. Reviewed ICU translations
win by default. Thus a new `godotExport` section can be imported without
overwriting the smart-brush and Defold messages already migrated.

When the lane also **edits existing legacy messages**, supply a comparison ref
that still contains the old catalogs:

```sh
pnpm i18n:import-legacy <path/to/tr.ts> <path/to/en.ts> --base-ref <lane-parent-revision>
```

Messages added or changed since that ref replace those JSON keys; unchanged
legacy messages preserve reviewed ICU text. The v1.6 integration used
`--base-ref 36cd32b` against `8ca6c20`: 31 additions per locale, no edits to
existing messages. Their exact legacy text is frozen in
`__fixtures__/merged-main.legacy.json` and checked at sample value 2 alongside
the original migration snapshot. New count messages get ICU plurals; review
singular sentence grammar after import. Remove leftover TS files explicitly
after reviewing the result, so production storage remains JSON-only.

Git-only imports are also supported from `packages/editor`:

```sh
pnpm i18n:migrate --ref <revision-containing-tr.ts-and-en.ts>
pnpm i18n:gen
```

`i18n:migrate` also accepts `--base-ref`. Without `--ref`, it reads restored
local `src/i18n/tr.ts` / `en.ts`. Both commands transpile trusted repository
catalogs, verify TR/EN key/placeholder parity before writing, and quote ICU
literals. They are developer tools, not a runtime import of untrusted files.
`__fixtures__/migration.expected.json` freezes the original rendered output of
every baseline key at sample value 2; singular wording changes have separate
tests. Direct `setLocale()` updates notify subscribers, refresh the existing
app-settings root revision, and request a canvas frame without remounting it.

Acceptance impact: accept4 `v05` language persistence keeps its existing settings
JSON and command selectors. Settings language selection now previews before
Save; Cancel restores the previous locale. No desktop host/file format changes.
