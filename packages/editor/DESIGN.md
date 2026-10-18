# Harita Tasarlayıcı — UI design spec (redesign 2026-10)

This is the single source of truth for how the editor looks and behaves at the UI layer.
Scope: **UI only**. `packages/core`, the file format, exporters and the Unity package do not change.
Nothing from CLAUDE.md "Yapılmayacaklar" comes back (no linked prefabs, blend modes, effects, workspaces, canvas rotation).

Reference feel: Photoshop (tool rail + options bar), Aseprite (density, keyboard-first, pixel-exact cursor), Figma UI3 (property rows, calm chrome).
The canvas is the product; chrome recedes. Every pixel has a job.

---

## 1. Principles (apply to every decision)

1. **One home per function.** A command may also live in a menu, the command palette and a context menu, but on screen it appears in exactly one visible place.
2. **Values, not instructions.** Labels are nouns. Explanations go to tooltips. At most one line of secondary text per dialog; no hint paragraphs in panels.
3. **Facts look like text; editable things look like fields.** Read-only values are plain text. Only typeable values get a field box.
4. **One accent per view.** Accent fill = the single primary action of the current surface (dialog submit; "Unity'ye aktar" in the app bar). Selection uses a soft tint + 1 px accent-line. Active tool = accent icon on `active` fill.
5. **Fixed sizes.** Only the sizes in §3 exist. No arbitrary `[..px]` classes except layout math that cannot be expressed with tokens.
6. **Instant.** 0 ms on the painting path (tool switch, hover, brush preview). UI motion ≤ 120 ms; panels 150 ms. Respect `prefers-reduced-motion`.
7. **Keyboard first.** Every tool has a key; tooltips show it. Focus rings are visible but never wrap huge containers (use an inset 1 px accent line for large focus targets).
8. **No slop.** No gradients, glass/blur, emoji, coloured category icons, pills (radius-full) except toggle switches and 6 px status dots, shadows on cards/rows/buttons, thick one-sided borders, centred text in panels, ALL-CAPS larger than 11 px, mixed icon strokes.

---

## 2. Color tokens (`src/theme/tokens.css`)

Keep the token **names** the canvas reads (`--color-canvas`, `--color-line`, `--color-accent`, collision/terrain/entity colours) and keep them `#rrggbb`.

| Token | Hex | Use |
|---|---|---|
| `canvas` | `#0b1217` | behind the map |
| `bg` | `#11171c` | app bar, tool rail, status bar |
| `field` (rename of `raised`; keep `raised` as alias) | `#141a21` | inputs, sunken wells |
| `panel` | `#1b212a` | panels, dock, options bar |
| `popup` | `#212932` | menus, tooltips, popovers, palette, HUD, toasts |
| `hover` | `#262e38` | hovered rows/buttons (must be visible on `popup`: menus use `hover-popup`) |
| `hover-popup` | `#2c3540` | hovered/highlighted item inside menus and popups |
| `active` | `#2a323c` | pressed button, active tool background, neutral "on" |
| `tab-row` | `#161c22` | tab strips (slightly darker than panel) |
| `line-subtle` | `#262d34` | dividers inside a panel |
| `line` | `#323b45` | panel edges, field borders at rest |
| `line-strong` | `#414b56` | popup borders, scrollbar thumb, field hover |
| `control-border` | `#64707c` | checkbox/radio/slider track outlines (3:1) |
| `title` | `#f7fbff` | panel/dialog titles, selected names |
| `text` | `#e6ebf0` | body, values, layer names (all layers, not only active) |
| `muted` | `#a4adb7` | labels, inactive tabs, icons at rest |
| `faint` | `#838c96` | units, placeholders, secondary numbers. Only on `bg`/`field`/`panel` |
| `accent` | `#69c9ae` | see principle 4 |
| `accent-hover` | `#86d8c0` | |
| `accent-press` | `#55b39a` | |
| `accent-soft` | `#1f3a3a` | selected row/tile/card background |
| `accent-line` | `#5b7679` | outline of selected row/card |
| `on-accent` | `#0b2a24` | text on accent fill |
| `map-bg` | `#151c23` | the map rectangle background (replaces hard-coded `0x1b1b1f` in canvas/colors.ts) |
| `checker-a` / `checker-b` | `#182027` / `#1f2830` | transparency checker (tileset, thumbnails) |
| danger / warning / success / info | `#f0707a` / `#e7b75f` / `#5fcf98` / `#5cb2ff` (+ `-soft` at 12% alpha) | validation, toasts, export checks |
| map overlays | collision `#ff5468`, pass `#5cb2ff`, terrain `#c39bff`, spawn `#4ade80`, portal `#b47bff` | canvas only, never as UI chrome |

Saved state is never green: "Kaydedildi" = `muted` text + check icon; unsaved = 6 px `warning` dot + text.

---

## 3. Type, spacing, sizes

**Type** (Inter Variable, `font-feature-settings: "cv11","ss01","tnum"` on numbers; JetBrains Mono only for coordinates X/Y and tile ids):

| Token | Size/LH | Weight | Use |
|---|---|---|---|
| `text-2xs` | 10/14 | 500 | ruler numbers, tiny badges |
| `text-xs` | 11/16 | 500–600 | section headers (UPPERCASE, +0.02em, `muted`), status bar, units, kbd |
| `text-sm` | 12/16 | 400/500 | **default UI size**: labels, rows, menu items, tabs, buttons, tooltips |
| `text-md` | 13/20 | 400/500 | input text, dialog body, panel titles |
| `text-lg` | 15/22 | 600 | dialog titles, welcome section titles |
| `text-xl` | 22/28 | 600 | welcome screen heading only |

Remove `text-title` (16 px): inspector titles use `text-md` 600 `title`. Only weights 400/500/600.

**Spacing** 4 px base: 2, 4, 6, 8, 12, 16, 24, 32. Panel inner padding 8 px (inspector 12 px). Label→control gap 8 px. Section gap 12 px + 1 px `line-subtle`.

**Radii**: `xs` 2 (tile thumbs), `sm` 4 (buttons, inputs, rows, chips), `md` 6 (menus, popovers, tooltips, cards, minimap), `lg` 8 (dialogs). `full` only for toggle switches and status dots.

**Fixed component sizes (the only ones allowed):**

| Thing | Size |
|---|---|
| App bar | 36 px |
| Tab strip (panel tabs, dock tabs, document tabs) | 28 px, text-sm, active = `title` text + 2 px accent underline; inactive = `muted` |
| Options bar | 36 px |
| Status bar | 24 px |
| Tool rail | 40 px wide, buttons 32×32, icons 20 |
| Icon button | `sm` 24×24 (icon 16) in panels/rows; `md` 28×28 (icon 16) in options bar/app bar |
| Text button | 24 px high in panels (px 8), 28 px in dialogs/app bar (px 12) |
| Input / select | 24 px in panels, 28 px in dialogs |
| List row | 24 px (menus, tree, tileset groups, history); 28 px (layers, inspector property rows) |
| Section header row | 28 px: `text-xs` uppercase `muted`, actions right (icon button sm) |
| Icons | 12 (chevrons, check marks), 16 (everywhere), 20 (tool rail only). Stroke 1.5 px absolute at all sizes |
| Dialog widths | S 400, M 560, L 880 (import/export may use L; nothing else) |
| Toggle switch | 28×16 |

**Elevation**: level 0 flat panels separated by 1 px `line`; level 1 popups = `popup` + 1 px `line-strong` + `0 8px 24px -6px rgb(0 0 0/.55)`; level 2 dialogs = level 1 + backdrop `rgb(5 9 12/.62)` (no blur).

**Motion**: hover colour 80 ms; menus/tooltips 120 ms fade + 2 px translate; panel collapse 150 ms; tooltip delay 500 ms then instant while moving within the same bar.

---

## 4. Layout (1440×900 reference; must work at 1366×768 and 1920×1080)

```
┌────────────────────────────────────────────────────────────────────────────┐ 36 App bar (bg)
│ ◆ Dosya Düzen Görünüm Harita Yardım │ Proje ▾ / [Ana harita ×][Zindan][+] │ ● Kaydedilmemiş  [Unity'ye aktar] │
├──┬──────────────┬──────────────────────────────────────────┬───────────────┤
│  │ Stamp | Proje│ ✎ Kalem  │ Boyut 1 ▾ │ 🎲 Rastgele │ … │ ▦ ⛶  │ Denetçi|Geçmiş│ 28 tabs
│T │──────────────├──────────────────────────────────────────┤               │ 36 options bar (panel)
│o │              │ruler                                     │  inspector    │
│o │  library     │                                          │  (296)        │
│l │  (260)       │               CANVAS                     ├───────────────┤
│  │              │                                ┌──────┐  │ KATMANLAR  +  │
│r │              │                                │ mini │  │  rows 28      │
│a │              ├──────────────────────────────────────────┤               │
│i │              │ Tileset | Son kullanılanlar   (dock)     │               │
│l │              │ [overworld ▾] [Boya|Katı|Arazi] … zoom   │               │
│40│              │ grid………………………………………………………………………………   │               │
├──┴──────────────┴──────────────────────────────────────────┴───────────────┤ 24 Status bar
│ X 12  Y 7 │ Tile 34 │ Katman: Zemin │ 64×48 │ 32 px          Harita|Dünya │ %100 ▾ │
└────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 App bar (36, `bg`)
- Left: 16 px logo glyph, menubar (text-sm, items 28 high, px 8).
- Then a 1 px divider, the **project name** button (`title`, 500, ▾ opens project menu: Yeniden adlandır, Proje ayarları…, Son projeler) followed by `/` in `faint` and the **document tabs** inline (28 high, max 180 px each, close `×` only on hover/active, dirty dot `warning` 6 px, `+` icon button). Document tabs no longer take their own row.
- Right: save state (`muted`, check icon or warning dot; `role=status`, `data-save-state`), then the single primary button "Unity'ye aktar" (28 px, accent, upload icon 16, keeps `data-export-unity`; opens the export dialog).

### 4.2 Tool rail (left, 40, `bg`, right border `line`)
Order (groups separated by 8 px gap + 1 px `line-subtle` 16 px wide):
1. Seç (S) · El (H)
2. Kalem (B) · Silgi (E) · Doldur (F) · Dikdörtgen (R)
3. Damlalık (I)
4. Entity (O)
Bottom: Dünya görünümü toggle (W), Ayarlar.
Button 32×32, radius 4, icon 20 `muted`; hover `hover` + `text`; active tool `active` fill + `accent` icon (no left bar, no accent fill). Tooltip right side: "Kalem  B".
The panel switcher rail is removed. `data-rail` values move: `world` and `settings` stay on the rail-bottom buttons; `library`/`project` go on the library panel tabs (§4.4) and Ctrl+B still toggles the left panel.

### 4.3 Options bar (36, `panel`, bottom border `line`, spans canvas column only)
- Left: active tool icon 16 + name (text-sm 500 `text`), 1 px divider, then **that tool's** options only (registry in `ui/toolOptions`): brush size chip "Boyut 1 ▾" (size/shape only when expanded), Rastgele toggle (dice icon + label; on = the multi-tile brush becomes a random set, off = back to the previous brush; disabled for a single tile with no saved sets) with saved-set picker when on, terrain set picker, flip/rotate icon buttons for brush/stamp (X, Y, Z), etc.
- Right: view toggles that apply to all tools as `md` icon buttons with tooltips: Izgara (Ctrl+G), Çarpışma overlay, Cetvel. No undo/redo, no zoom, no search here (zoom lives in the status bar; palette is Ctrl+K and the Yardım menu).
- When narrow, right-side toggles collapse into `⋯`.

### 4.4 Left panel — Library (default 260, min 220, max 400, resizable, Ctrl+B)
- Tab strip (28): **Stamp'ler | Proje**. The "Tileset'ler" tab is removed: tilesets live in the dock only (§4.6). (Tileset management — groups, search, remove, add — moves into the dock's tileset switcher and its "Tümü" view.)
- Stamp'ler: search field (24) + filter row (category chips radius 4, 24 high; favourites star toggle monochrome, accent when on) + grid/list toggle + card size slider in a compact header; cards: thumbnail on checker, name text-sm, meta `faint` text-xs. Selected card = `accent-soft` + 1 px `accent-line`. No banner; "Seçimi stamp olarak kaydet" lives in the inspector region section and the canvas context menu.
- Proje: tree (rows 24): Haritalar (levels, double-click opens, F2 rename), Stamp'ler count. Level row actions on hover.

### 4.5 Right column (default 296, min 260, max 420, Ctrl+Alt+B)
- Top: tabs **Denetçi | Geçmiş** (28).
- Inspector = Figma-style property sections. Section = header row 28 (`text-xs` uppercase `muted`) + property rows 28: label column 72 px (`muted` text-sm) + value. Facts are plain text (`text`, numbers tabular, right part of the row). Editable numbers are 24 px fields with label scrubbing (drag on the label: 1 unit / 4 px, Shift ×10) if it can be done without core changes; arrows ±1, Shift ±10.
- Inspector header: 16 px icon + title text-md 600 `title` + optional subtitle `faint`; no 40×40 icon tile.
- Contexts (logic in `ui/inspector/mode.ts` stays): entity → entity fields; region → DÖNÜŞÜM (X, Y coordinates and horizontal/vertical size glyphs) + actions as a row of `sm` icon buttons with tooltips plus one secondary text button "Stamp olarak kaydet"; brush/stamp/random → FIRÇA İÇERİĞİ (80 px preview on checker, tileset name + tile id as facts, flip/rotate buttons, random list with weights; no "Rastgele yap" button — the "Rastgele" toggle lives in the options bar); terrain → ARAZİ; collision layer → solid/passable; nothing → HARİTA facts (size, tile, layers count is NOT repeated) + "Harita ayarları…" text button.
- No tool selector in the inspector (tool lives on the rail only).
- Bottom: **Katmanlar** section below a splitter (default 40%, min 5 rows). Header 28: "KATMANLAR" + add (menu) + delete icon buttons. Opacity slider for the selected layer as a compact row under the header. Rows 28: visibility eye (left, always visible), type glyph 16 `muted`, name `text` (selected `title`), lock shown only on hover or when locked, opacity % `faint` when <100. Selected row `accent-soft` + 1 px `accent-line`. Double-click renames.
- Geçmiş: rows 24, newest at bottom, current row `accent-soft`, future rows `faint`. Labels are verbs ("Katman ekle", "Boya 12 hücre").

### 4.6 Bottom dock (spans canvas column; default height fits content: min(8 tile rows at current zoom + header, 40% of window), min 96, collapsible to its tab strip; remembered)
- Tab strip 28: **Tileset | Son kullanılanlar**, right side: collapse chevron.
- Tileset tab header row 32 (no side column): tileset switcher (name ▾, 24 high, max 200, tooltip with full name + size; menu lists all tilesets grouped, search field at top, "Tileset ekle…", "Tümü" view entry, per-tileset ⋯ actions: Ayarlar, Görseli değiştir, Gruba taşı, Kaldır) · 1 px divider · **mode segmented control "Boya | Katı | Arazi"** (radiogroup "Tileset modu", 24 high) · Tek/Tümü view toggle (labelled icon buttons) · spacer · "+ Palet" text button · zoom field (%).
- In Katı/Arazi mode: the grid gets a 1 px mode-colour inset frame (collision red / terrain violet) and the 32 px dock header replaces the Tek/Tümü toggle and "+ Palet" with one short, truncated instruction (full text in a tooltip) + a 24 px secondary "Bitti" button. There is no separate mode strip. The inspector switches to the mode (terrain card already exists).
- Grid uses the full dock width. Tile hover = 1 px white @20% + dark keyline; selection = 1 px accent + dark keyline + `accent-soft` 30% fill.
- Recent tab: one row of 32 px swatches with labels in tooltips.

### 4.7 Status bar (24, `bg`, top border `line`, text-xs `muted`)
Segments divided by 1 px `line-subtle`, 12 px padding: X/Y (mono, `text`), tile id, layer, map size, tile px. Right: Harita|Dünya segmented (20 high) and the **zoom field** (editable, "%100" Turkish format, ▾ presets: Sığdır Ctrl+0, %50, %100 Ctrl+1, %200, %400). This is the only zoom readout.

### 4.8 Canvas & overlays
- Map rectangle background `map-bg`; outside `canvas`.
- Grid: 1 px; alpha fades with zoom (≤50%: hidden, 100%: 0.10, ≥200%: 0.14), colour from `line`-ish white.
- Hover cell / brush footprint: 1 px `accent` inner line + 1 px `rgba(0,0,0,.6)` outer keyline (visible on sand and grass). Brush ghost 50% opacity. Eraser footprint uses `danger`.
- Selection: existing marching ants (keep), hover outline inside a selection uses the footprint style, not white.
- Rulers 20 px, `bg`, text-2xs `faint`, labels every 10 tiles, ticks every tile; horizontal labels for the vertical ruler (not rotated) when they fit.
- Minimap 176×120 max, `popup` fill, 1 px `line-strong`, radius 6, 8 px inset bottom-right, viewport rect 1 px accent + dark keyline; hidden when the map fits, hidden by Tab.
- Toasts: bottom-centre of the canvas, 12 px above the canvas bottom edge (above the dock), shifted left to clear the minimap by 8 px, `popup`, radius 6, one line, text-sm; 4 s, action toasts 8 s, errors stay until dismissed; never for saves.
- Undo HUD / blocked feedback: same toast style (radius 6, not pills), bottom-centre of the canvas, 12 px above the canvas bottom edge (above the dock), shifted left to clear the minimap by 8 px; undo HUD stacks above toasts.
- Brush size HUD near cursor on `[`/`]`: "3 × 3", 120 ms fade, hides 600 ms after last change (only if not already present; do not add if risky).

### 4.9 Menus, tooltips, context menus, command palette
- Menu: `popup`, radius 6, padding 4, items 24 high, px 8, text-sm, icon 16 column optional, shortcut right in `muted` mono text-xs (no boxed keycaps in menus), highlighted item `hover-popup`, separators 1 px `line-subtle` with 4 px margin, danger items `danger` text.
- Tooltip: `popup`, radius 4, px 8 py 4, text-sm `text`, shortcut in a `kbd` chip (text-xs mono `muted`, 1 px `line-strong`, radius 2).
- Command palette: width M 560, top 12vh, input 40 high text-md, rows 32: command name `text` + category `faint` + shortcut right; empty query shows recent commands first.

### 4.10 Dialogs & welcome
- Dialog: radius 8, header (title text-lg 600, optional one-line subtitle `muted`, close icon button), body padding 16, footer row: secondary "Vazgeç" (neutral `active` fill) + primary (accent) right-aligned; destructive primary uses danger.
- Form rows: label above field in dialogs (text-sm `muted`), 12 px between rows; segmented controls for small enums (24/28 high, radius 4, selected = `active` fill + `title` text + 1 px `line-strong`, not accent).
- Advanced sections: plain disclosure "› Gelişmiş" (no bordered card).
- Welcome screen: left-aligned two-column layout, max width 1040, vertically centred. Left column (360): app name text-xl, three action rows (Yeni proje… Ctrl+N, Aç… Ctrl+O, Tileset bırak – the drop zone is a dashed 1 px `line-strong` area 96 high), then "Şablonlar" as compact rows (icon 16 + name + meta `faint`). Right column: "Son projeler" grid of cards (thumbnail 16:10 on checker, name, date `faint`), empty state = one line `muted`.

---

## 5. Icons
- One `<Icon>` primitive (`ui/primitives/Icon.tsx`), Lucide geometry, stroke 1.5 px **absolute** (scale stroke by 24/size so it renders 1.5 px at every size), round caps/joins. Sizes 12/16/20 only. No `strokeWidth` overrides except 12 px check marks (2 px).
- Glyphs: Seç `square-dashed`, El `hand`, Kalem `pencil`, Silgi `eraser`, Doldur `paint-bucket`, Dikdörtgen `square`, Damlalık `pipette`, Entity `box`, Stamp `stamp`, Rastgele `dices`, Arazi `mountain`, Katmanlar `layers`, göz `eye`/`eye-off`, kilit `lock`/`lock-open`, çevir `flip-horizontal-2`/`flip-vertical-2`, döndür `rotate-cw`/`rotate-ccw`, ızgara `grid-3x3`, geri al `undo-2`/`redo-2`, geçmiş `history`, ara `search`, ekle `plus`, sil `trash-2`, kopyala `copy`, kes `scissors`, yapıştır `clipboard-paste`, dışa aktar `upload`, tileset ekle `image-up`, ayarlar `settings-2`, dünya `map`, çarpışma `brick-wall`, başlangıç `flag`, portal `door-open`, kütüphane `library`, proje `folder-tree`, favori `star`, açılır `chevron-down`.

---

## 6. Hard constraints for every lane
- Do not edit `packages/core`, exporters' output, file format, `canvas/` engine logic (only listed overlay/visual files), commands semantics or shortcut keys (`shortcuts/shortcuts.ts` may only gain entries if a spec item needs one — avoid).
- Keep every `data-*` attribute and accessible role/name listed in `/tmp/claude-0/-home-user-map/71aa0adb-d0ed-56a0-9a7b-c70c93d2a345/scratchpad/redesign/audit.md` §3 on an element with the same meaning. If an element is removed by the spec (e.g. library Tileset tab), move its attribute to the new home with the same behaviour, or update the affected e2e test in `/home/user/map/e2e/tests` in the same change and say so.
- All visible text from `src/i18n/tr.ts` + `en.ts` (same keys in both; edit only the section of your area; add keys at the end of your section).
- Tokens only; no hard-coded colours in TSX (canvas code reads tokens via `canvas/colors.ts`).
- `pnpm typecheck`, `pnpm lint`, `pnpm test` must pass.
