import { expect, test } from "../support/fixtures";
import { moveTab, openDockMap, savedLayout } from "../support/docking";

const zone = (id: string) => `[data-dock-zone="${id}"]`;

test("default homes and drag moves preserve the same mounted Tileset, Recent moves left and back", async ({ page }) => {
  await openDockMap(page);
  await expect(page.locator(`${zone("left")} [data-panel-tab=tileset]`)).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(`${zone("bottom")} [data-panel-tab]`)).toHaveCount(1);
  await page.locator("[data-panel=tileset]").evaluate(el => { (window as unknown as { movedHost: Element }).movedHost = el; });
  await moveTab(page, "tileset", `${zone("right")} [data-dock-strip="0"]`);
  await expect(page.locator(`${zone("right")} [data-panel=tileset]`)).toBeVisible();
  expect(await page.locator("[data-panel=tileset]").evaluate(el => el === (window as unknown as { movedHost: Element }).movedHost)).toBe(true);
  await moveTab(page, "recent", `${zone("left")} [data-dock-strip="0"]`);
  await expect(page.locator(`${zone("left")} [data-recent-strip]`)).toBeVisible();
  await page.locator("[data-panel-tab=recent]").click({ button: "right" });
  await page.locator("[data-context-item=move]").hover();
  await page.locator("[data-context-item=move-bottom]").click();
  await expect(page.locator(`${zone("bottom")} [data-recent-strip]`)).toBeVisible();
  await expect(page.locator("[data-panel=tileset]")).toHaveCount(1);
});

test("drag reorders and splits; canceled and outside drops leave the full layout unchanged", async ({ page }) => {
  await openDockMap(page);
  await moveTab(page, "stamps", "[data-panel-tab=tileset]", { x: 1, y: 12 });
  expect((await savedLayout(page)).zones.left.groups[0].tabs[0]).toBe("stamps");
  await moveTab(page, "tileset", zone("right"), { x: 100, y: 1 });
  expect((await savedLayout(page)).zones.right.groups.at(0).tabs).toEqual(["tileset"]);
  const before = await savedLayout(page);
  const b = (await page.locator("[data-panel-tab=tileset]").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + 12); await page.mouse.down();
  await page.mouse.move(b.x - 80, b.y + 100, { steps: 8 });
  await page.keyboard.press("Escape"); await page.mouse.up();
  expect(await savedLayout(page)).toEqual(before);
  await page.mouse.move(b.x + b.width / 2, b.y + 12); await page.mouse.down();
  const canvas = (await page.locator("[data-canvas-host]").boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, { steps: 8 }); await page.mouse.up();
  expect(await savedLayout(page)).toEqual(before);
});

test("keyboard context menu supports move, split, merge, reorder and hide; palette restores the panel", async ({ page }) => {
  await openDockMap(page);
  const tab = page.locator("[data-panel-tab=tileset]");
  await tab.focus(); await page.keyboard.press("Shift+F10");
  await expect(page.locator("[data-context-menu]")).toBeVisible();
  await page.locator("[data-context-item=move]").hover();
  await expect(page.locator("[data-context-item=move-left]")).toBeDisabled();
  await page.locator("[data-context-item=move-right]").click();
  await expect(page.locator(`${zone("right")} [data-panel-tab=tileset]`)).toBeVisible();
  await tab.click({ button: "right" }); await page.locator("[data-context-item=split]").click();
  expect((await savedLayout(page)).zones.right.groups).toHaveLength(3);
  await tab.click({ button: "right" }); await page.locator("[data-context-item=merge]").click();
  expect((await savedLayout(page)).zones.right.groups).toHaveLength(2);
  await tab.click({ button: "right" }); await page.locator("[data-context-item=forward]").click();
  await tab.click({ button: "right" }); await page.locator("[data-context-item=hide]").click();
  await expect(tab).toHaveCount(0);
  await openDockMap(page);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("Tileset’i göster");
  await page.keyboard.press("Enter");
  await expect(page.locator(`${zone("right")} [data-panel=tileset]`)).toBeVisible();
});

test("empty and hidden zones expose drop targets only during dragging", async ({ page }) => {
  await openDockMap(page);
  await page.locator("[data-zone-hide=right]").click();
  await page.locator("[data-zone-hide=bottom]").click();
  await expect(page.locator("[data-dock-drop-zone]")).toHaveCount(0);
  const a = (await page.locator("[data-panel-tab=tileset]").boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + 12); await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + 22);
  await expect(page.locator("[data-dock-drop-zone=right]")).toBeVisible();
  const bottom = (await page.locator("[data-dock-drop-zone=bottom]").boundingBox())!, canvas = (await page.locator("[data-canvas-host]").boundingBox())!;
  expect(bottom.x).toBe(canvas.x); expect(bottom.width).toBe(canvas.width);
  const b = (await page.locator("[data-dock-drop-zone=right]").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.up();
  await expect(page.locator(`${zone("right")} [data-panel=tileset]`)).toBeVisible();
  await expect(page.locator("[data-dock-drop-zone]")).toHaveCount(0);
});

test("moved panels reveal through existing commands, keyboard menu navigation and F2 without changing homes", async ({ page }) => {
  await openDockMap(page);
  const tile = page.locator("[data-panel-tab=tileset]");
  await tile.focus(); await page.keyboard.press("Shift+F10");
  await expect(page.locator("[data-context-menu]")).toBeVisible();
  await expect(page.locator("[data-context-menu]")).toBeFocused(); await page.keyboard.press("ArrowDown");
  await expect(page.locator("[data-context-item=move]")).toBeFocused(); await page.keyboard.press("ArrowRight");
  await expect(page.locator("[data-context-item=move-right]")).toBeFocused(); await page.keyboard.press("Enter");
  await expect(page.locator(`${zone("right")} [data-panel-tab=tileset]`)).toBeVisible();
  await moveTab(page, "layers", `${zone("left")} [data-dock-strip="0"]`);
  await page.locator("[data-zone-hide=left]").click();
  await page.keyboard.press("F2");
  await expect(page.locator(`${zone("left")} [data-layers-list] input`)).toBeFocused();
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const { useDockStore } = await import(/* @vite-ignore */ String("/src/ui/layout/dockStore.ts"));
    const { showHistory } = await import(/* @vite-ignore */ String("/src/ui/history/historyCommands.ts"));
    useDockStore.getState().move("history", { zone: "bottom" });
    useDockStore.getState().setZoneState("bottom", "hidden"); showHistory();
  });
  await expect(page.locator(`${zone("bottom")} [data-panel=history]`)).toBeVisible();
  await page.locator("[data-zone-hide=right]").click();
  await page.evaluate(async () => {
    const { gotoTileset } = await import(/* @vite-ignore */ String("/src/commands/tilesetActions.ts"));
    const { useEditorStore } = await import(/* @vite-ignore */ String("/src/state/editorStore.ts"));
    gotoTileset(useEditorStore.getState().project.store.document.tilesets[0].id);
  });
  await expect(page.locator(`${zone("right")} [data-tileset-viewport]`)).toBeVisible();
});

test("moving Tileset preserves its inner DOM, search, zoom, selection and scroll", async ({ page }) => {
  await openDockMap(page);
  await page.locator("[data-library-view=all]").click();
  const search = page.locator("[data-tileset-search]");
  await search.fill("over");
  await page.locator("[data-tileset-zoom-label]").click();
  await page.getByRole("menuitem", { name: "%400", exact: true }).click();
  const viewport = page.locator("[data-tileset-viewport]");
  await viewport.evaluate(el => {
    el.scrollTop = 80; el.scrollLeft = 50;
    (window as unknown as { tilesetInner: Element }).tilesetInner = el;
  });
  await moveTab(page, "tileset", `${zone("right")} [data-dock-strip="0"]`);
  await expect(search).toHaveValue("over");
  expect(await viewport.evaluate(el => el === (window as unknown as { tilesetInner: Element }).tilesetInner)).toBe(true);
  await expect(page.locator("[data-tileset-zoom-label]")).toHaveText("128 px");
  expect(await viewport.evaluate(el => el.scrollTop)).toBe(80);
});

test("group body drops add tabs and bottom-edge splits run horizontally", async ({ page }) => {
  await openDockMap(page);
  await moveTab(page, "stamps", `${zone("right")} [data-dock-group="0"]`, { x: 100, y: 120 });
  expect((await savedLayout(page)).zones.right.groups[0].tabs).toContain("stamps");
  await moveTab(page, "tileset", zone("bottom"), { x: 1, y: 40 });
  const groups = page.locator(`${zone("bottom")} [data-dock-group]`);
  await expect(groups).toHaveCount(2);
  const a = (await groups.nth(0).boundingBox())!, b = (await groups.nth(1).boundingBox())!;
  expect(a.x).toBeLessThan(b.x); expect(a.y).toBe(b.y);
  await expect(page.locator(`${zone("bottom")} [data-group-splitter]`)).toHaveAttribute("aria-orientation", "vertical");
});

test("all eight registered panels move through all three zones with exactly one mounted home", async ({ page }) => {
  await openDockMap(page);
  await page.evaluate(async () => {
    const { runCommand } = await import(/* @vite-ignore */ String("/src/commands/registry.ts")); runCommand("layer.addEntity");
  });
  await expect(page.locator("[data-panel-tab=entities]")).toBeVisible();
  for (const panel of ["tileset", "stamps", "project", "recent", "inspector", "history", "layers", "entities"]) for (const destination of ["left", "right", "bottom"]) {
    await page.evaluate(async ({ panel, destination }) => {
      const { runCommand } = await import(/* @vite-ignore */ String("/src/commands/registry.ts")); runCommand(`panel.${panel}.${destination}`); runCommand(`panel.${panel}.show`);
    }, { panel, destination });
    await expect(page.locator(`[data-dock-zone=${destination}] [data-panel=${panel}]`)).toBeVisible();
    await expect(page.locator(`[data-panel=${panel}]`)).toHaveCount(1);
    await expect(page.locator(`[data-panel-tab=${panel}]`)).toHaveCount(1);
  }
});
