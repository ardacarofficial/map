/** Windows-safe file names: export base names, stamp ids / paths, level paths. */
import { describe, expect, it } from "vitest";
import {
  addLevel,
  createStamp,
  createDocument,
  exportBaseName,
  exportTmj,
  exportUnityMap,
  fileNameProblem,
  isReservedFileName,
  makeStampId,
  safeFileName,
  stampIdProblem,
  stampPath,
} from "../src";

describe("Windows reserved device names", () => {
  it("are recognised in any case and with any extension", () => {
    for (const name of ["CON", "con", "Prn", "aux", "NUL", "com1", "COM9", "lpt1", "LPT9", "con.tmj", "nul.tar.gz", "CON .txt", "conin$", "COM¹"]) {
      expect(isReservedFileName(name)).toBe(true);
    }
    for (const name of ["console", "con-2", "com10", "lpt", "acon", "my.con", "map"]) expect(isReservedFileName(name)).toBe(false);
  });

  it("exportBaseName never returns a device name, forbidden characters or trailing dots/spaces", () => {
    expect(exportBaseName("CON")).toBe("CON_");
    expect(exportBaseName("nul")).toBe("nul_");
    expect(exportBaseName("com1")).toBe("com1_");
    expect(exportBaseName("con.v2")).toBe("con_.v2");
    expect(exportBaseName('a<b>:c"d/e\\f|g?h*i\u0001')).toBe("a_b__c_d_e_f_g_h_i_");
    expect(exportBaseName("Zindan. . ")).toBe("Zindan");
    expect(exportBaseName(" ... ")).toBe("map");
    expect(exportBaseName("Orman")).toBe("Orman");
    const doc = createDocument({ width: 1, height: 1 });
    expect(exportTmj(doc, "AUX").fileName).toBe("AUX_.tmj");
    expect(exportUnityMap(doc, "lpt3").fileName).toBe("lpt3_.smapmap");
    for (const raw of ["CON", "x.", "a:b", "", "prn.txt "]) expect(fileNameProblem(safeFileName(raw, "map"))).toBeNull();
  });

  it("stamp ids, ids made from names and stamp paths avoid device names", () => {
    expect(stampIdProblem("con")).toMatch(/reserved/);
    expect(stampIdProblem("com1")).toMatch(/reserved/);
    expect(stampIdProblem("console")).toBeNull();
    expect(makeStampId("Con")).toBe("con-2");
    expect(makeStampId("LPT1")).toBe("lpt1-2");
    expect(makeStampId("Nul", ["nul-2"])).toBe("nul-3");
    expect(() => stampPath("con")).toThrow(/reserved/);
    expect(stampPath("ev")).toBe("stamps/ev.json");
    const doc = createDocument({ width: 1, height: 1 });
    expect(() => createStamp(doc, [], { x: 0, y: 0, width: 1, height: 1 }, { id: "aux", name: "Aux" })).toThrow(/reserved/);
  });

  it("addLevel rejects level paths that cannot be created on Windows", () => {
    const project = { name: "p", levels: [], tilesets: [] };
    for (const path of ["levels/con.json", "levels/a:b.json", "levels/x.json.", "nul/a.json", "levels/a?.json"]) {
      expect(() => addLevel(project, { name: "x", path })).toThrow(/addLevel: path/);
    }
    expect(addLevel(project, { name: "x", path: "levels/console.json" }).levels).toHaveLength(1);
  });
});
