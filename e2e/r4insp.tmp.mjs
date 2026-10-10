import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const OUT = "/tmp/claude-0/-home-user-map/71aa0adb-d0ed-56a0-9a7b-c70c93d2a345/scratchpad/r4inspector";
const bytes = [...readFileSync("/home/user/map/samples/tilesets/overworld-32.png")];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const [w, h] of [[1366, 768], [1920, 1080]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript(() => { window.showDirectoryPicker = () => navigator.storage.getDirectory(); });
  await page.goto("http://localhost:5241/");
  await sleep(1500);
  await page.evaluate(({ bytes }) => {
    const target = document.querySelector("[role=button][tabindex='0']");
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], "overworld-32.png", { type: "image/png" }));
    for (const kind of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(kind, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { bytes });
  await sleep(800);
  const card = page.getByTestId("tileset-card");
  if (await card.isVisible().catch(() => false)) await card.locator("button[type=submit]").click();
  await sleep(1500);
  const shot = async (name) => { await sleep(400); await page.screenshot({ path: `${OUT}/${w}-${name}.png` }); };
  const mode = () => page.evaluate(() => document.querySelector("[data-inspector]")?.getAttribute("data-inspector-mode"));
  console.log(w, "initial mode", await mode());
  await shot("1-brush-empty");
  // pick a tile
  const grid = page.getByRole("grid", { name: /overworld/i }).first();
  const img = grid.locator(".checker").first();
  if (await img.isVisible().catch(() => false)) {
    const b = await img.boundingBox();
    await img.click({ position: { x: Math.min(b.width - 4, 60), y: 20 } });
  }
  console.log(w, "after pick", await mode());
  await shot("2-brush-tile");
  // multi-tile: drag in tileset
  if (await img.isVisible().catch(() => false)) {
    const b = await img.boundingBox();
    await page.mouse.move(b.x + 10, b.y + 10); await page.mouse.down(); await page.mouse.move(b.x + 80, b.y + 60, { steps: 6 }); await page.mouse.up();
  }
  console.log(w, "after multi", await mode());
  await shot("3-brush-clip");
  const rnd = page.locator("[data-action=makeRandom]");
  if (await rnd.isVisible().catch(() => false)) { await rnd.click(); console.log(w, "made random"); }
  await shot("4-brush-random");
  // brush size 3
  await page.locator("canvas[aria-label='map canvas']").first().focus();
  await page.keyboard.press("e"); await page.keyboard.press("]"); await page.keyboard.press("]");
  await shot("5-eraser-size");
  await page.keyboard.press("["); await page.keyboard.press("[");
  // select region
  await page.keyboard.press("s");
  const c = await page.locator("canvas[aria-label='map canvas']").first().boundingBox();
  await page.mouse.move(c.x + c.width / 2 - 100, c.y + c.height / 2 - 60); await page.mouse.down(); await page.mouse.move(c.x + c.width / 2 + 40, c.y + c.height / 2 + 40, { steps: 8 }); await page.mouse.up();
  console.log(w, "after select", await mode());
  await shot("6-region");
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await page.keyboard.press("h");
  console.log(w, "hand", await mode());
  await shot("7-map");
  // history tab
  await page.evaluate(() => { const b = [...document.querySelectorAll("button,[role=tab]")].find((e) => /Geçmiş/.test(e.textContent || "")); b?.click(); });
  await shot("8-history");
  // map settings
  await page.keyboard.press("Control+k"); await sleep(300); await page.keyboard.type("Harita ayar"); await sleep(300); await page.keyboard.press("Enter");
  await shot("9-mapsettings");
  console.log(w, "errors", errors.slice(0, 8));
  await page.close();
}
await browser.close();
