# Harita Tasarlayıcı — UI design spec (redesign 2026-10)

This is the single source of truth for how the editor looks and behaves at the UI layer.
Scope: **UI rules for every lane**. Core, file-format, exporter and Unity work is allowed under the v1.5 plan's data and migration rules.
Nothing from CLAUDE.md "Yapılmayacaklar" comes back (no linked prefabs, blend modes, effects, workspaces, canvas rotation).

Reference feel: Photoshop (tool rail + options bar), Aseprite (density, keyboard-first, pixel-exact cursor), Figma UI3 (property rows, calm chrome).
The canvas is the product; chrome recedes. Every pixel has a job.

---

## 1. Principles (apply to every decision)

1. **One home per function.** A command may also live in a menu, the command palette and a context menu, but on screen it appears in exactly one visible place.
2. **Values, not instructions.** Labels are nouns. Explanations go to tooltips. At most one line of secondary text per dialog; no hint paragraphs in panels.
3. **Facts look like text; editable things look like fields.** Read-only values are plain text. Only typeable values get a field box.
4. **One accent per view.** Accent fill = the single primary action of the current surface (dialog submit; "Dışa aktar" in the app bar). Selection uses a soft tint + 1 px accent-line. Active tool = accent icon on `active` fill.
5. **Fixed sizes.** Only the sizes in §3 exist. No arbitrary `[..px]` classes except layout math that cannot be expressed with tokens.
6. **Instant.** 0 ms on the painting path (tool switch, hover, brush preview). UI motion ≤ 120 ms; panels 150 ms. Respect `prefers-reduced-motion`.
7. **Keyboard first.** Every tool has a key; tooltips show it. Focus rings are visible but never wrap huge containers (use an inset 1 px accent line for large focus targets). F6 cycles focus in physical zone order: canvas → left groups → right groups → bottom groups; Shift+F6 reverses the order; Tab hides panels only while the canvas is focused.
8. **No slop.** No gradients, glass/blur, emoji, coloured category icons, pills (radius-full) except toggle switches and 6 px status dots, shadows on cards/rows/buttons, thick one-sided borders, centred text in panels, ALL-CAPS larger than 11 px, mixed icon strokes.

---

## 2. Color tokens (`src/theme/tokens.css`)

Keep the token **names** the canvas reads (`--color-canvas`, `--color-line`, `--color-accent`, collision/entity colours) and keep them `#rrggbb`.

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
| `grid-major` | `#64707c` | major canvas guides (`--color-grid-major`) |
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
| map overlays | collision `#ff5468`, pass `#5cb2ff`, spawn `#4ade80`, portal `#b47bff` | canvas only, never as UI chrome |

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
| Settings dialog / sidebar | 880 / 160 px (`--spacing-dialog-l`, `--spacing-settings-sidebar`); category Select replaces sidebar below dialog M width |
| App bar | 36 px |
| Tab strip (panel tabs, dock tabs, document tabs) | 28 px, text-sm, active = `title` text + 2 px accent underline; inactive = `muted` |
| Options bar | 36 px |
| Status bar | 24 px |
| Tool rail | 40 px wide, buttons 32×32, icons 20 |
| Left dock zone (default/min/max) | 260/220/400 px; `--dock-left-default` / `--dock-left-min` / `--dock-left-max` |
| Right dock zone (default/min/max) | 296/260/420 px; `--dock-right-default` / `--dock-right-min` / `--dock-right-max` |
| Bottom dock zone (default/min/max) | 68/64/480 px; `--dock-bottom-default` / `--dock-bottom-min` / `--dock-bottom-max`; preserve `--dock-canvas-min-height` (160 px) |
| Collapsed dock rail/tab strip | 28 px, `--dock-collapsed`; hidden = 0 px |
| Dock splitter hit area / line | 6/1 px, `--dock-splitter-hit` / `--dock-line` |
| Panel drag threshold | 4 px (`--spacing`), with pointer capture |
| Drop edge / insertion caret | 24/2 px, `--dock-drop-edge` / `--dock-caret` |
| Panel tab scroll arrows | 24×24 px (`--spacing-control-sm`); controls stay outside the scroller |
| Tileset header rows | 32 px (`--spacing-control-rail`) + 1 px bottom divider (`--dock-line`); below 560 px, two rows, plus one for palette columns |
| Bottom Tileset content minimum | 190 px = `--spacing-tabrow` + 5 × `--spacing-control-rail` + 2 × `--dock-line`; palette controls add 32 px (222 total) |
| Recent swatches / content row | 32 px (`--spacing` ×8) / 40 px (`--spacing-recentstrip`); with the 28 px tab strip = `--dock-bottom-default` |
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
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ Dosya Düzen Görünüm Harita Yardım │ Proje / [Ana harita ×][+] │ Dışa aktar              │
├────┬─────────────────────────────┬──────────────────────────────┬───────────────────────┤
│    │ Tileset | Stamp'ler | Proje │ Kalem · Boyut · Akıllı …     │ Denetçi | Geçmiş      │
│T   ├─────────────────────────────┼──────────────────────────────┤                       │
│o   │ Tileset selector            │ ruler                        │ inspector             │
│o   │ Tek/Tümü · Palet · zoom     │                              │ (296)                 │
│l   │                             │           CANVAS             ├───────────────────────┤
│    │ grid (260)                  │                    [minimap] │ KATMANLAR +           │
│r   │                             ├──────────────────────────────┤ rows 28               │
│a   │                             │ Son kullanılanlar            │                       │
│i   │                             │ [tile] [stamp] …             │                       │
│l 40│                             │ bottom (68)                  │                       │
├────┴─────────────────────────────┴──────────────────────────────┴───────────────────────┤
│ X 12 Y 7 │ Tile 34 │ Katman: Zemin │ 64×48 │ 32 px                 Harita|Dünya │ %100 ▾│
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 App bar (36, `bg`)
- Left: 16 px logo glyph, menubar (text-sm, items 28 high, px 8).
- Then a 1 px divider, the **world name** button (`title`, 500, ▾ opens project menu: Yeniden adlandır, Dünya ayarları…, Son dünyalar) followed by `/` in `faint` and the **document tabs** inline (28 high, max 180 px each, close `×` only on hover/active, dirty dot `warning` 6 px, `+` icon button). Document tabs no longer take their own row.
- Right: save state (`muted`, check icon or warning dot; `role=status`, `data-save-state`), then the single primary button "Dışa aktar" (28 px, accent, upload icon 16, keeps `data-export-unity` and `data-export-open`; opens the export dialog on the last successful target).

The project is one **Dünya / World**, containing **Harita / Map** documents. The breadcrumb is `<world name> / <map tabs>`; both names retain inline rename (world menu / map context menu also available). Renaming preserves ids, portal targets and source paths. File actions create/open/save/close worlds; the Map menu and tab `+` add a map to the current world. Welcome says “Yeni dünya”, with separate world and first-map name fields (default “Ana harita”). The `project` panel is titled “Dünya” and lists this world’s maps. Dünya view is this world’s map overview, with the world name in its hint and status. World settings explicitly describe defaults for future maps; map settings apply to the active map. Map exports use the map display name; the whole-world Zip archive retains the world name. Internal project identifiers and `project.smap` stay unchanged.

### 4.2 Tool rail (left, 40, `bg`, right border `line`)
Order (groups separated by 8 px gap + 1 px `line-subtle` 16 px wide):
1. Seç (S) · El (H)
2. Kalem (B) · Silgi (E) · Doldur (F) · Dikdörtgen (R)
3. Damlalık (I)
4. Entity (O)
Bottom: Ayarlar (`settings-2`). Dünya görünümü stays in the status-bar Harita|Dünya segment and on W.
Button 32×32, radius 4, icon 20 `muted`; hover `hover` + `text`; active tool `active` fill + `accent` icon (no left bar, no accent fill). Tooltip right side: "Kalem  B".
The panel switcher rail is removed. `data-rail` values move: `world` moves to the status-bar Dünya radio; `settings` stays on the rail-bottom button; `library`/`project` go on the library panel tabs (§4.4) and Ctrl+B still toggles the left panel.

### 4.3 Options bar (36, `panel`, bottom border `line`, spans canvas column only)
- The leading neutral segmented control is **Tile | Piksel** (M), sharing the camera/map and remembering each mode's tool and size. Switching modes cancels a pending gesture.
- Piksel rail: pencil B, eraser E, fill F, eyedropper I, line L, rectangle R; Hand/Select remain. Options contain integer pixel size (1–64), square/circle, cell/all-world scope, contiguous/global fill, outline/filled rectangle and mirror axes about the map centre. Right button paints the background colour; Alt temporarily samples, Shift samples the active layer. Pixel cursor/ghost and pixel coordinates use native map pixels.
- Minimal colour controls use 24 px foreground/background swatches and a HEX RGBA popover; Shift+X swaps and D resets. The colour store owns app-settings persistence and a committed-choice recent list for the later Renk panel. Painting is overwrite in straight RGBA, without antialiasing. Pixel edits are frozen COW assets grouped as Düzenlenen; a stroke has one world-history entry.
- Left: active tool icon 16 + name (text-sm 500 `text`), 1 px divider, then **that tool's** options only (registry in `ui/toolOptions`): brush size chip "Boyut 1 ▾" (size/shape only when expanded), Rastgele toggle (dice icon + label; on = the multi-tile brush becomes a random set, off = back to the previous brush; disabled for a single tile with no saved sets) with saved-set picker when on, a single "Akıllı" switch (`data-smart-brush`) and "Alan | Yol" control (on an automatic smart source B/freehand/Shift-line = road, R = area; per-tool override resets on a new brush; F keeps pattern fill; a thick source snaps road units to the world-origin lattice, with size counting units and a tooltip stating the tile width), flip/rotate icon buttons for brush/stamp (X, Y, Z), etc.
- A rectangular source keeps one Akıllı control: on/off, Tek nesne (off by default; enabled for a full rectangle of at least 3×3, with a tooltip explaining the manual override), preparing, or unavailable with a reason. A forced recipe uses the smallest geometric band (b=1), is remembered for the source selection, and saves as ordinary smart-stamp metadata. Incomplete/small selections stay disabled with a reason. Native source/map grid mismatch is shown beside it. An empty map offers an undoable grid change; populated maps open Yeni harita prefilled. An empty-map import asks once whether to adopt the source grid; pixels are never rescaled.
- Right: view toggles that apply to all tools as `md` icon buttons with tooltips: Izgara (Ctrl+G), Çarpışma overlay, Cetvel. No undo/redo, no zoom, no search here (zoom lives in the status bar; palette is Ctrl+K and the Yardım menu).
- Damlalık's "Katman" scope defaults to "Tümü": right-click, Alt or I picks the topmost visible nonempty tile and activates its source layer, including locked sources; painting locks still apply. "Etkin" reads only the active layer; area pick remains on the active layer. Picking creates no undo step.
- Seç has "Dikdörtgen | Bağlı alan". Connected selection uses four-neighbour cells with the same tile and all flip bits; Shift adds, Ctrl/Alt subtracts. Move/copy/cut/delete/paste, X/Y, Z/Shift+Z, Tile değiştir and Stamp olarak kaydet use the same mask.
- When narrow, right-side toggles collapse into `⋯`; the grid-settings disclosure remains available. Its "Kılavuz ızgara" popover has "Kapalı" or 2–64 tile intervals and an X/Y origin relative to the map's top-left. Settings persist per project in localStorage, outside the document format.

### 4.4 Three zones and panels
- Three dock zones surround the canvas: left, right and bottom. Default left tabs: **Tileset | Stamp'ler | Proje**, Tileset active; the Entity palette appears in its own tab when relevant. Default right: **Denetçi | Geçmiş** above **Katmanlar**, split 60%/40%. Default bottom: **Son kullanılanlar** only. Each panel has one visible home. World view reveals Proje at its current home, shows world context in Denetçi and hides Katmanlar in any zone; Tileset and Son kullanılanlar remain available.
- Every panel can move to any zone. Drag a tab to reorder it or move it between zones; drop on a group body to add a tab, or on a zone edge to create a split group. Left/right groups stack vertically; bottom groups sit horizontally. No recursive split tree or floating windows. Dropping outside the window or in the canvas centre cancels.
- Tab context menu: **Taşı → Sol / Sağ / Alt**, **Öne taşı**, **Arkaya taşı**, **Bölümü ayır**, **Sekme olarak birleştir**, **Gizle**. The same actions are available by keyboard and command palette; Shift+F10 / Ctrl+F10 or the context-menu key opens the menu. Tab arrow navigation stays intact. Selection, search and scroll survive a move; reveal commands open the panel at its current or remembered home.

### 4.5 Size and visibility
- Each zone resizes from its outer edge and remembers its expanded size; dimensions and limits are the §3 `--dock-*` tokens. Viewport fitting never overwrites saved sizes. Group splitters adjust proportions within a zone.
- Header chevron or outer-splitter double-click toggles expanded/collapsed. Collapsed left/right zones are 28 px tab rails; collapsed bottom is a 28 px tab strip. Hidden zones take 0 px; the Görünüm menu restores them. **Ctrl+B** toggles left, **Ctrl+Alt+B** right, **Ctrl+Shift+B** bottom; hidden/collapsed opens, expanded collapses.
- On an outer splitter: arrows resize from the displayed edge by 16 px, Shift+arrows by 48 px; Enter toggles collapse, Home resets size. Esc/pointercancel rolls back a resize. A tab drag commits only on a valid drop; Esc/cancel leaves the source in place.
- With canvas focus, Tab temporarily hides all three zones, the tool rail and minimap; Tab again restores their previous states. Text fields, menus and dialogs retain normal Tab navigation.
- Layout v2 persists in desktop `settings.json` (`layout`) and the `smap.layout.v2` localStorage cache, with legacy migration. Startup priority: valid settings layout → local v2 → legacy → defaults. **Düzeni sıfırla** restores panel homes/order/groups, sizes, visibility, active tabs and rulers, and clears temporary Tab hiding.

### 4.6 Dock appearance and content
- Tab strip 28 px, `tab-row`; active = `title` text + 2 px `accent` underline, inactive = `muted`. Splitter = `--dock-line` (1 px) `line` with `--dock-splitter-hit` (6 px) hit area; hover `accent-line`, keyboard focus `accent`.
- Drop target = `accent-soft` fill + `--dock-line` `accent-line` border; tab insertion = `--dock-caret` (2 px) `accent` line. Empty/hidden zone targets appear only during tab drag. No extra accent colour, card shadows or floating windows.
- Horizontal panel tab strips retain full labels and scroll on overflow, with 24 px previous/next arrow buttons (`--spacing-control-sm`). Selected and keyboard-focused tabs are revealed; collapse/close controls stay outside the scroller.
- Tileset management, search, groups, Tek/Tümü, Palet and zoom stay in the panel header; painting selection comes directly from its grid. Content fits and scrolls in whichever zone hosts it.
- Tek PNG uses one remembered source-pixel viewport transform: continuous cursor-anchored zoom (0.125–16), nearest sampling, device-snapped origin, Space/middle drag and native scrollbars. Trackpad movement pans; Ctrl/pinch zooms; Shift-wheel pans horizontally. Zoom is a text readout; Sığdır runs only on request. Tümü retains its scrolling list and Ctrl-wheel zoom. Source margins/gutters are not selectable tiles.
- Referansları kopyala/kes carries a rectangle of references including holes and flip flags. Cutting a PNG clears only the transient selection; pixels, tile ids and source bytes stay intact. Paste targets a user palette; the PNG view offers a destination hint and Palete yapıştır picker. Palette cut is undoable. Clipboard shortcuts and F2 apply to the focused tileset panel without stealing map/text-field shortcuts.
- Tileset Yeniden adlandır changes only the display name, through the shared rename prompt and undoable metadata operation. Palette Sütun and Satır use adjacent 24 px number fields. Rows are explicit, without a spare row; paste/drop may grow rows up to the capacity limit. Occupied shrink is refused with a short message and a separate Sığmayan referansları kaldır confirmation; no implicit deletion or row reflow.
- Smart detection requires pixel evidence for full nonempty 3×3 selections and larger n×m blocks with continuous b-cell outer bands and tiling edge/centre segments. The smallest evidenced b wins; the centre spans at least one tile per axis and dimensions need not be multiples of b (e.g. 5×5 or 7×6 with b=2). Thick bands and full-span segments require mirrored opposite profiles at every segment position, coherent corner depth profiles (allowing a constant RGB tint) and edge/centre distinction throughout each band. Round bushes, compact objects, ambiguous artwork, borderless periodic and randomly shaded materials stay plain. Road draws b×b macro cells aligned to world (0,0); area tiles the centre and symmetrically splices outer bands on short axes. Direct selection and saved stamps share the source; generated direct-selection names include size and zero-based sheet position, e.g. `<tileset> 3×3 @ col,row (yol)`.
- Tileset header: below 560 px host width, two 32 px rows plus a 1 px bottom divider; source selector/search and palette-add action first, Tek/Tümü and zoom controls second. Palette dimensions add a third 32 px row, with validation wrapping below when needed. At 560 px and above the controls share one row. Use §3 tokens; palette-add, Fit and override-reset are icon buttons with tooltips.
- Switcher: name ▾ (24 high, max 200, full name + size in tooltip); grouped tilesets and actions Yeniden adlandır, Ayarlar, Görseli değiştir, Gruba taşı, Kaldır. Tümü includes search; tileset section names keep full-name tooltips.
- An expanded bottom zone hosting an active Tileset reserves at least 190 px, or 222 px with palette controls (§3); this presentation minimum never overwrites remembered size. Collapsed zones remain 28 px.
- Grid uses the full panel width. Tile hover = 1 px white @20% + dark keyline; selection = 1 px accent + dark keyline + `accent-soft` 30% fill.
- Son kullanılanlar: one row of 32 px swatches with labels in tooltips; the Görünüm and command-palette command uses the same "Son kullanılanlar" label.
- Stamp'ler: search field (24) + filter row (category chips radius 4, 24 high; favourites star toggle monochrome, accent when on) + grid/list toggle + card size slider in a compact header; cards: thumbnail on checker, name text-sm, meta `faint` text-xs. Selected card = `accent-soft` + 1 px `accent-line`. No banner; "Seçimi stamp olarak kaydet" lives in the inspector region section and the canvas context menu.
- Proje: tree (rows 24): Haritalar (levels, double-click opens, F2 rename), Stamp'ler count. Level row actions on hover.
- Inspector = Figma-style property sections. Section = header row 28 (`text-xs` uppercase `muted`) + property rows 28: label column 72 px (`muted` text-sm) + value. Facts are plain text (`text`, numbers tabular, right part of the row). Editable numbers are 24 px fields with label scrubbing (drag on the label: 1 unit / 4 px, Shift ×10) if it can be done without core changes; arrows ±1, Shift ±10.
- Inspector header: 16 px icon + title text-md 600 `title` + optional subtitle `faint`; no 40×40 icon tile.
- Contexts (logic in `ui/inspector/mode.ts` stays): entity → entity fields; region → DÖNÜŞÜM (X, Y coordinates and horizontal/vertical size glyphs) + actions as a row of `sm` icon buttons with tooltips plus one secondary text button "Stamp olarak kaydet"; brush/stamp/random → FIRÇA İÇERİĞİ (80 px preview on checker, tileset name + tile id as facts, flip/rotate buttons, random list with weights; no "Rastgele yap" button — the "Rastgele" toggle lives in the options bar); manual Collision layer → "Engel" / "Geçilebilir"; nothing → HARİTA facts (size, tile, layers count is NOT repeated) + "Harita ayarları…" text button.
- Tileset-origin brush previews assemble one joined raster at native source resolution, then scale once with smoothing off. Source/map size differences are facts; map-region and multilayer previews retain map-space composition. Full-text inspector action buttons have no label-only tooltip; shortcut/disabled explanations remain, and activation closes the tooltip before opening an inline form.
- No tool selector in the inspector (tool lives on the rail only). Saved smart stamps show "Kaynak" / "b hücre kenar" as facts; the options bar owns the single "Akıllı" switch. Disabling smart keeps the source and recipe; saved stamps persist `smartDisabled`.
- **Katmanlar:** Header 28: "KATMANLAR" + add (menu) + delete icon buttons. Opacity slider for the selected layer as a compact row under the header. Rows 28: visibility eye (left, always visible), type glyph 16 `muted` for non-tile layers only (fixed column keeps names aligned), name `text` (selected `title`), lock shown only on hover or when locked, opacity % `faint` when <100. Selected row `accent-soft` + 1 px `accent-line`. Double-click renames.
- Geçmiş: rows 24, newest at bottom, current row `accent-soft`, future rows `faint`. Labels are verbs ("Katman ekle", "Boya 12 hücre").
  Undo/redo follows one chronological history across the world, activates the action’s origin map, and shows its name in each row; a compound pixel edit is one step. Temporary stamp documents keep local history; deleting a participating map explicitly resets world history.

### 4.6.1 Kullanımları bul
- One results home: a section at the top of the existing Denetçi. It follows the inspector's dock zone, so users can keep drawing and move the list with the established layout. Tileset/selection and palette-slot context menus plus the command palette start the same read-only world search; no search modal or extra panel.
- Map name and per-map count, layer, zero-based X/Y, tile id and flip facts use ordinary text. Rows are keyboard buttons (Click/Enter jumps); the current row uses neutral `active`, focus uses `accent`. Only 50 results are mounted per page; next/previous usage follows the full list across pages. Refresh and close stay in the section, with F3/Shift+F3 labels from the single shortcut list.
- Navigation activates the map, centres the cell and flashes the existing one-cell `accent` feedback; it creates no selection or history entry. Any content/list/disk change marks the snapshot “Değişti — yenile” and disables stale jumps. Unopened maps are parsed/scanned in a worker without activating or caching them; live documents are scanned in sparse chunk batches with a 4 ms scheduling budget.

### 4.7 Status bar (24, `bg`, top border `line`, text-xs `muted`)
Segments divided by 1 px `line-subtle`, 12 px padding: X/Y (mono, `text`), tile id, layer, map size, tile px. Right: Harita|Dünya segmented (20 high) and the **zoom field** (editable, "%100" Turkish format, ▾ presets: Sığdır Shift+1, %50, %100 Ctrl+0, %200, %400). This is the only canvas zoom readout; Tileset has its own zoom control.

### 4.8 Canvas & overlays
- Map rectangle background `map-bg`; outside `canvas`.
- Grid: 1 px; alpha fades with zoom (≤50%: hidden, 100%: 0.10, ≥200%: 0.14), colour from `line`-ish white.
- Major grid: one device-pixel line using `grid-major` (`--color-grid-major`), clipped to the map. Hide when guide spacing falls below 6 CSS px; Ctrl+G hides it together with the base grid.
- Hover cell / brush footprint: 2 px `accent` inner line at ≥100% zoom, 1 px below 100%, with a 1 px `rgba(0,0,0,.6)` outer keyline (visible on sand and grass). Brush ghost 50% opacity. Eraser footprint uses `danger`.
- Selection: 10% `accent` fill on selected cells only; marching ants and a dark keyline follow the actual mask boundary, including holes, without internal tile-edge lines. Rectangular selections retain their existing appearance. Cache mask geometry; ant animation updates only the eight-pixel texture. Hover outline inside a selection uses the footprint style, not white.
- Rulers 20 px, `bg`, text-2xs `faint`, labels every 10 tiles, ticks every tile; horizontal labels for the vertical ruler (not rotated) when they fit.
- Minimap 176×120 max, `popup` fill, 1 px `line-strong`, radius 6, 8 px inset bottom-right, viewport rect 1 px accent + dark keyline; hidden when the map fits, hidden by Tab.
- Toasts: at most one visible; each new toast replaces the current one. Bottom-centre of the canvas, 12 px above the canvas bottom edge (above the dock), shifted left to clear the minimap by 8 px, `popup`, radius 6, one line, text-sm; 4 s, action toasts 8 s, errors stay until dismissed; never for saves.
- Undo HUD / blocked feedback: same toast style (radius 6, not pills), bottom-centre of the canvas, 12 px above the canvas bottom edge (above the dock), shifted left to clear the minimap by 8 px; undo HUD stacks above toasts.
- Brush size HUD near cursor on `[`/`]`: "3 × 3", 120 ms fade, hides 600 ms after last change (only if not already present; do not add if risky).

### 4.9 Menus, tooltips, context menus, command palette
- Menu: `popup`, radius 6, padding 4, items 24 high, px 8, text-sm, icon 16 column optional, shortcut right in `muted` mono text-xs (no boxed keycaps in menus), highlighted item `hover-popup`, separators 1 px `line-subtle` with 4 px margin, danger items `danger` text. App menus and the recent-project submenu fit the available viewport height and scroll vertically.
- Tooltip: `popup`, radius 4, px 8 py 4, text-sm `text`, shortcut in a `kbd` chip (text-xs mono `muted`, 1 px `line-strong`, radius 2).
- Command palette: width M 560, top 12vh, input 40 high text-md, rows 32: command name `text` + category `faint` + shortcut right; empty query shows recent commands first.

### 4.9.1 Yer imleri
- One menu home: Görünüm → Yer imleri. Add uses the existing name prompt; each named row has jump/rename/delete actions in its submenu. The command palette provides “Yer imi: <name>” and named rename/delete entries for the current map. The palette updates when a map switch or asynchronous view-setting load changes its entries. No permanent bookmark panel.
- Ctrl+Shift+D adds; Ctrl+1…9 jumps to the first nine entries in list order. These free defaults and their user overrides come only from `shortcuts.ts`. Names are fields only while adding/renaming; listed names are text. Existing menu/scroll/focus primitives and token sizes apply.
- A bookmark stores the centre in map pixels and zoom in local view storage, keyed by world identity + stable map id. Desktop folders use their path; browser directory handles get a persistent identity using `isSameEntry` (equal folder names remain separate worlds). Unsaved worlds are isolated per session; first save carries their bookmarks over before reporting completion. Corrupt/blocked storage is tolerated and a failed persistence write reports session-only retention. No map-format or undo change. Jumps snap through the existing camera restore path and clamp to valid cell centres after a map resize.

### 4.10 Dialogs & welcome
- Settings uses an L dialog, 160 px category sidebar, 1 px divider and scrollable category body. Header and Save/Cancel footer stay visible at short heights. Arrow Up/Down and Home/End navigate the sidebar; narrow windows replace it with one category Select.
- General, Appearance, Panels, Shortcuts, Language, Export and Advanced share one draft, including Advanced JSON. Panel/ruler/language edits preview; Cancel/close/Esc restores the opening snapshot. Save uses the serialized settings writer; write failure retains the draft. Facts are plain text, controls use shared 24/28 px primitives.
- Panels edits existing left/right/bottom dock groups, including contextual panels. Add moves an existing panel; hide, reorder, zone selection, split/merge and reset use the existing flat dock model.
- Shortcuts lists every single-source command, searches translated names/categories/keys and records before app commands. Conflicts require explicit Replace/Cancel; reset-all requires confirmation. Held Space/middle pan stays fixed. Each shortcut row shows its scope as a plain-text fact; matching chords conflict only within that scope. Language shows native names and translation completeness; export selects the world’s default/last successful target and shows that target’s defaults from the same registry as the export dialog.

- Harita → "Kenar…" (also in the command palette) opens an M dialog with live canvas preview: "Kalınlık", "İç boşluk", four side toggles, and gap rows (side/start/length). Gap starts are zero-based from the inset boundary, left→right or top→bottom, and cut through the full thickness without clearing existing cells. Use the current tile/pattern/random/smart brush on the active visible, unlocked tile layer; smart corners use the core planner. Report clamped dimensions on narrow maps and blocked-layer reasons. "Uygula" is one undo step; Esc/"Vazgeç" leaves the document unchanged.
- Dialog: radius 8, header (title text-lg 600, optional one-line subtitle `muted`, close icon button), body padding 16, footer row: secondary "Vazgeç" (neutral `active` fill) + primary (accent) right-aligned; destructive primary uses danger.
- Form rows: label above field in dialogs (text-sm `muted`), 12 px between rows; segmented controls for small enums (24/28 high, radius 4, selected = `active` fill + `title` text + 1 px `line-strong`, not accent).
- Advanced sections: plain disclosure "› Gelişmiş" (no bordered card).
- Welcome screen: left-aligned two-column layout, max width 1040, vertically centred. Left column (360): app name text-xl, three action rows (Yeni proje… Ctrl+N, Aç… Ctrl+O, Tileset bırak – the drop zone is a dashed 1 px `line-strong` area 96 high), then "Şablonlar" as compact rows (icon 16 + name + meta `faint`). Right column: "Son projeler" grid of cards (thumbnail 16:10 on checker, name, date `faint`), empty state = one line `muted`.

### 4.10.1 Export dialog
- **Dışa aktar** is the one home for Unity, Tiled TMJ, PNG, JSON, Zip, Godot 4 and Defold. L dialog; target radio rows show a name and one-line description, followed by destination, target options and layer selection. The right column shows the map preview, preflight problems and planned files. Errors block publication; engine entity/portal companions stay beside the native resources.
- Successful exports remember the target and options per world. Cancelling or a failed export keeps the previous selection. Folder choices and Unity's export-on-save switch retain their existing immediate persistence; automatic export remains Unity-only. Resolve all files before publishing, write resources before map entry points, and preserve unrelated destination files.


### 4.10.2 PNG'ye uygula
- One M dialog with the established 80 px preview size is shared by the command palette, Piksel options overflow and the edited tileset context menu. It lists source tile ids, crisp before/after previews and world cell counts. Divergent copies require an explicit radio choice or skip; generated, expanded, missing and uncaptured-grid origins are listed as unavailable. A source picker shows the actual project PNG path and a reserved unique `backups/png/` path as text.
- “Bu kaynağı kullanan hücrelerin görünüşü değişir” and the paint-undo exclusion remain visible before confirmation. A changed source invalidates confirmation; Yeniden yükle starts a fresh review of current disk pixels. Grid changes never invent a new source rectangle. Edited copies and cell references remain independent.
- “Yedekten geri yükle” uses the same dialog, lists backups for the chosen PNG and previews the selected backup against current disk pixels. Its explicit confirmation first backs up the current file. Backup failures leave the source untouched; no source write is part of paint history.
- Ordinary save/autosave creates missing source PNGs but never replaces existing source bytes. Görseli değiştir selects an immutable revision path; undo/redo follows that path even when dimensions match. Only the confirmed apply/restore action overwrites a source PNG.
- Write-back supports static PNGs up to the core RGBA capacity. Sixteen-bit/animated sources and older clones without a captured grid are refused rather than reduced or assigned a guessed rectangle. Native Windows/WebView2 verification remains a release gate; Linux host tests do not substitute for it.


---

## 5. Icons
- One `<Icon>` primitive (`ui/primitives/Icon.tsx`), Lucide geometry, stroke 1.5 px **absolute** (scale stroke by 24/size so it renders 1.5 px at every size), round caps/joins. Sizes 12/16/20 only. No `strokeWidth` overrides except 12 px check marks (2 px).
- Glyphs: Seç `square-dashed`, El `hand`, Kalem `pencil`, Silgi `eraser`, Doldur `paint-bucket`, Dikdörtgen `square`, Damlalık `pipette`, Entity `box`, Stamp `stamp`, Rastgele `dices`, Katmanlar `layers`, göz `eye`/`eye-off`, kilit `lock`/`lock-open`, çevir `flip-horizontal-2`/`flip-vertical-2`, döndür `rotate-cw`/`rotate-ccw`, ızgara `grid-3x3`, geri al `undo-2`/`redo-2`, geçmiş `history`, ara `search`, ekle `plus`, sil `trash-2`, kopyala `copy`, kes `scissors`, yapıştır `clipboard-paste`, dışa aktar `upload`, tileset ekle `image-up`, ayarlar `settings-2`, dünya `map`, çarpışma `brick-wall`, başlangıç `flag`, portal `door-open`, kütüphane `library`, proje `folder-tree`, favori `star`, açılır `chevron-down`.

---

## 6. Hard constraints for every lane
- These UI rules apply to every lane; core, format, exporter and Unity changes follow the v1.5 plan's data and migration rules. Keep edits within the lane's assigned ownership.
- Keep every `data-*` attribute and accessible role/name listed in `/tmp/claude-0/-home-user-map/71aa0adb-d0ed-56a0-9a7b-c70c93d2a345/scratchpad/redesign/audit.md` §3 on an element with the same meaning. If an element is removed by the spec (e.g. a fixed panel host), move its attribute to the new home with the same behaviour, or update the affected e2e test in `/home/user/map/e2e/tests` in the same change and say so.
- Every visible string through `t()`; same complete keys in built-in TR/EN resources (`src/i18n/locales/<id>/<feature>.json`), with ICU placeholders/plurals and matching argument names checked in tests. Add keys in your own feature file per locale; run `pnpm i18n:gen`.
- Tokens only; no hard-coded colours in TSX (canvas code reads tokens via `canvas/colors.ts`).
- `pnpm typecheck`, `pnpm lint`, `pnpm test` must pass.
