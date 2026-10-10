import { confirmTilesetCard, dropFile, expect, sampleBytes, test } from "../support/fixtures";
const OUT = "/tmp/claude-0/-home-user-map/71aa0adb-d0ed-56a0-9a7b-c70c93d2a345/scratchpad/probe/";
test("probe", async ({ page }) => {
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE", m.type(), m.text()); });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto("http://localhost:5300/");
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + "01-welcome.png" });
  await dropFile(page, "[data-welcome-drop]", "overworld-32.png", sampleBytes("tilesets/overworld-32.png"));
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + "02-after-drop.png" });
  await confirmTilesetCard(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + "03-editor.png" });
  console.log((await page.locator("body").innerText()).slice(0, 3000));
});
