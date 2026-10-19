/* global process, console, document */
/** Opt-in pinned-engine acceptance. Requires the lane Vite server and Java,
 * plus official 1.9.8 bob.jar. Optional fourth argument: pinned headless engine.
 * Otherwise xvfb-run and graphical engine libraries must already be available.
 * No downloads, global tools or changes to the user's Defold project.
 */
import { chromium } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const server = process.argv[2] ?? "http://localhost:5881";
const jar = process.argv[3] ?? "/tmp/defold/bob.jar";
const project = "/tmp/defold/verification";
const commit = "67542769598a1b794877c96f740f3f527f63f491";
const version = execFileSync("java", ["-jar", jar, "--version"], { encoding: "utf8" });
if (!version.includes(commit)) throw new Error("Expected official Defold 1.9.8 Bob");
const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
let files;
try {
  const page = await browser.newPage();
  await page.goto(server);
  files = await page.evaluate(async (modulePath) => {
    const { createDocument, MapStore, makeCell, exportDefold, FLIP_H, FLIP_V, FLIP_D } = await import(modulePath);
    const atlas = { id: "a", name: "Atlas", imagePath: "C:\\art\\a.png", tileWidth: 16, tileHeight: 16, columns: 4, rows: 2, margin: 1, spacing: 2 };
    const store = new MapStore(createDocument({ width: 8, height: 4, tileWidth: 16, tileHeight: 16, tilesets: [atlas, { ...atlas, id: "b" }] }));
    store.dispatch({ type: "addLayer", layer: { id: "ground", name: "Ground" } });
    store.dispatch({ type: "addLayer", layer: { id: "top", name: "Top", visible: false } });
    const paint = (layerId, x, y, tileId, bits = 0, tileset = "a") => {
      const flags = ((bits & 1 ? FLIP_H : 0) | (bits & 2 ? FLIP_V : 0) | (bits & 4 ? FLIP_D : 0)) >>> 0;
      store.dispatch({ type: "paintCells", layerId, cells: [{ x, y, cell: makeCell(store.getOrAddPaletteIndex(tileset, tileId), flags) }] });
    };
    paint("ground", 0, 0, 0); paint("ground", 1, 0, 3); paint("ground", 0, 1, 7); paint("ground", 1, 1, 1, 0, "b");
    for (let bits = 0; bits < 8; bits++) paint("ground", bits, 3, bits, bits);
    paint("top", 0, 0, 4);
    store.dispatch({ type: "addLayer", layer: { id: "col", name: "Collision", type: "grid", role: "collision" } });
    store.dispatch({ type: "paintGrid", layerId: "col", cells: [{ x: 3, y: 2, value: 1 }] });
    const canvas = document.createElement("canvas");
    canvas.width = 72; canvas.height = 36;
    const ctx = canvas.getContext("2d");
    for (let i = 0; i < 8; i++) {
      const x = 1 + (i % 4) * 18, y = 1 + Math.floor(i / 4) * 18;
      // Unequal corner colours and areas reveal transposition/rotation errors.
      ctx.fillStyle = "#804020"; ctx.fillRect(x, y, 16, 16);
      ctx.fillStyle = "#ff0000"; ctx.fillRect(x, y, 5, 7);
      ctx.fillStyle = "#00ff00"; ctx.fillRect(x + 9, y, 7, 3);
      ctx.fillStyle = "#0000ff"; ctx.fillRect(x, y + 11, 3, 5);
      ctx.fillStyle = "#ffff00"; ctx.fillRect(x + 11, y + 9, 5, 7);
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve));
    const png = new Uint8Array(await blob.arrayBuffer());
    return exportDefold(store.document, "fixture", () => png).map((file) => "text" in file ? file : { path: file.path, bytes: [...file.bytes] });
  }, `/@fs${resolve("packages/core/src/index.ts")}`);
} finally { await browser.close(); }

for (const file of files) {
  const path = join(project, file.path);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "text" in file ? file.text : new Uint8Array(file.bytes));
}
await mkdir(join(project, "input"), { recursive: true });
await writeFile(join(project, "input/game.input_binding"), "");
await writeFile(join(project, "game.project"), "[project]\ntitle = Defold exporter acceptance\n[bootstrap]\nmain_collection = /exported/fixture/map.collectionc\n[display]\nwidth = 128\nheight = 64\n[physics]\ntype = 2D\n[resource]\ncustom_resources = /exported/fixture/game.json\n");
const goPath = join(project, "exported/fixture/map.go");
await writeFile(goPath, await readFile(goPath, "utf8") + '\ncomponents { id: "probe" component: "/probe.script" }\n');
await writeFile(join(project, "probe.script"), `
function init(self)
  local ok, err = pcall(function()
    local url = "/map#layer-0000-0"
    assert(tilemap.get_tile(url, "ground", 1, 0) == 1, "file0 -> Lua1")
    assert(tilemap.get_tile(url, "ground", 2, 0) == 4, "top-right")
    assert(tilemap.get_tile(url, "ground", 1, -1) == 8, "bottom-left")
    assert(tilemap.get_tile(url, "ground", 2, -1) == 0, "empty source split")
    assert(tilemap.get_tile("/map#layer-0000-1", "ground", 2, -1) == 2, "second source")
    local masks = {0,1,2,3,6,4,7,5}
    for i, mask in ipairs(masks) do
      local info = tilemap.get_tile_info(url, "ground", i, -3)
      assert(info.index == i, "rotation tile index")
      assert(info.h_flip == (bit.band(mask, 1) ~= 0), "H flag")
      assert(info.v_flip == (bit.band(mask, 2) ~= 0), "V flag")
      assert(info.rotate_90 == (bit.band(mask, 4) ~= 0), "rotation flag")
    end
    local box = physics.get_shape("/collision-0000#collision", "box-0")
    assert(math.abs(box.dimensions.x - 16) < 0.001, "box width")
    assert(math.abs(box.dimensions.y - 16) < 0.001, "box height")
    print("DEFOLD_EXPORT_VERIFIED: numbering, Y, D4, multisource, 1-cell collision")
  end)
  if not ok then print("DEFOLD_EXPORT_FAILED: " .. tostring(err)) end
  msg.post("@system:", "exit", {code = ok and 0 or 1})
end
`);
const build = spawnSync("java", ["-Xmx1g", "-jar", jar, "--root", project, "--platform", "x86_64-linux", "--archive", "build"], { encoding: "utf8", timeout: 300000 });
await writeFile("/tmp/defold/verification-build.log", (build.stdout ?? "") + (build.stderr ?? ""));
if (build.status !== 0) throw new Error("Bob build failed; see /tmp/defold/verification-build.log");
// Stored tile IDs do not prove the PNG was cut correctly. Check the compiled
// texture set using the official generated protobuf classes in the pinned jar.
const textureProbe = "/tmp/defold/TextureProbe.java";
await writeFile(textureProbe, `
import java.nio.file.*;
import com.dynamo.gamesys.proto.TextureSetProto.TextureSet;
class TextureProbe {
  public static void main(String[] args) throws Exception {
    for (String path : args) {
      var set = TextureSet.parseFrom(Files.readAllBytes(Path.of(path)));
      if (set.getTileCount() != 8 || set.getTexCoords().size() != 8 * 32)
        throw new IllegalStateException("Wrong compiled tile count: " + set.getTileCount());
      if (set.getTileWidth() != 16 || set.getTileHeight() != 16)
        throw new IllegalStateException("Wrong compiled tile dimensions");
    }
    System.out.println("DEFOLD_TEXTURES_VERIFIED: two sources, eight frames each");
  }
}
`);
const textureCheck = execFileSync("java", ["-cp", jar, textureProbe, ...[0, 1].map((i) => join(project, `build/default/exported/fixture/tileset-000${i}.t.texturesetc`))], { encoding: "utf8", timeout: 60000 });
await writeFile("/tmp/defold/verification-textures.log", textureCheck);
const engine = process.argv[4] ?? "/tmp/defold/dmengine";
if (!process.argv[4]) await writeFile(engine, execFileSync("unzip", ["-p", jar, "libexec/x86_64-linux/dmengine"], { maxBuffer: 50 * 1024 * 1024 }), { mode: 0o755 });
const args = ["--config=engine.run_while_iconified=1", join(project, "build/default/game.projectc")];
const run = spawnSync(process.argv[4] ? engine : "xvfb-run", process.argv[4] ? args : ["-a", engine, ...args], { encoding: "utf8", timeout: 60000, env: { ...process.env, LIBGL_ALWAYS_SOFTWARE: "1" } });
const output = (run.stdout ?? "") + (run.stderr ?? "");
await writeFile("/tmp/defold/verification-runtime.log", output);
if (run.status !== 0 || !output.includes("DEFOLD_EXPORT_VERIFIED:")) throw new Error("Engine assertions failed; see /tmp/defold/verification-runtime.log");
console.log(version.trim());
console.log(textureCheck.trim());
console.log("Official Bob build and native engine assertions passed. Logs: /tmp/defold/verification-{build,runtime}.log");
