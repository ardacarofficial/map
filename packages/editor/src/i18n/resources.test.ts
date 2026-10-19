import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { availableLocales, formatNumber, getLocale, setLocale, subscribeLocale, t } from "./index";
import { createCatalog } from "./catalog";
import { localeResources } from "./resources";
import { argumentSchema } from "./schema";
import { messageArguments } from "./messages.generated";

const fixtureLocale = "pl-x-i18n";
const fixtures = import.meta.glob<string>("./__fixtures__/locales/*/*.json", { eager: true, query: "?raw", import: "default" });
afterEach(() => setLocale("tr"));

describe("locale resources", () => {
  it("discovers an added folder through the same glob/catalog path without a locale enum", () => {
    const catalog = createCatalog({ ...localeResources, ...fixtures }, vi.fn());
    expect(catalog.availableLocales()).toContainEqual(expect.objectContaining({ id: fixtureLocale, nativeName: "Polski", completeness: expect.any(Number) }));
    expect(catalog.availableLocales().find(l => l.id === fixtureLocale)!.completeness).toBeLessThan(1);
    expect(availableLocales().map(l => l.id)).toEqual(expect.arrayContaining(["tr", "en"]));
    expect(availableLocales().some(l => l.id === fixtureLocale)).toBe(false);
    expect(catalog.format(fixtureLocale, "feedback.cells", { count: 1 })).toBe("1 komórka");
    expect(catalog.format(fixtureLocale, "feedback.cells", { count: 2 })).toBe("2 komórki");
    expect(catalog.format(fixtureLocale, "feedback.cells", { count: 5 })).toBe("5 komórek");
    expect(catalog.format(fixtureLocale, "feedback.cells", { count: 0 })).toBe("0 komórek");
  });

  it("requires complete built-in key and argument parity and parses every message", () => {
    const catalog = createCatalog(localeResources, vi.fn());
    for (const id of ["tr", "en"]) {
      expect(catalog.availableLocales().find(l => l.id === id)!.completeness).toBe(1);
      expect(Object.fromEntries(Object.entries(catalog.schemas(id)).map(([k, args]) => [k, Object.keys(args)])))
        .toEqual(Object.fromEntries(Object.entries(messageArguments).map(([k, args]) => [k, Object.keys(args)])));
    }
  });

  it("uses Turkish per-key fallback with a diagnostic and tolerates malformed optional JSON/ICU/arguments", () => {
    const diagnostic = vi.fn();
    const catalog = createCatalog({ ...localeResources, ...fixtures,
      "./locales/pl-x-i18n/broken.json": "{",
      "./locales/pl-x-i18n/app.json": JSON.stringify({ name: "{broken" }),
      "./locales/pl-x-i18n/common.json": JSON.stringify({ cancel: "{unexpected}" }),
      "./locales/xx/meta.json": "not json",
    }, diagnostic);
    expect(catalog.format(fixtureLocale, "app.name")).toBe(catalog.format("tr", "app.name"));
    expect(catalog.format(fixtureLocale, "common.cancel")).toBe(catalog.format("tr", "common.cancel"));
    expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining(fixtureLocale));
    expect(diagnostic).toHaveBeenCalledWith(expect.stringContaining("app.name"));
    expect(catalog.format("not_a_locale", "app.name")).toBe(catalog.format("tr", "app.name"));
    expect(catalog.format(fixtureLocale, "unknown.key")).toBe("unknown.key");
  });

  it("formats plurals for 0/1/2, accepting existing numeric string params", () => {
    setLocale("en");
    for (const [key, noun] of [["feedback.cells", "cell"], ["inspector.layersCount", "layer"], ["stampLib.count", "stamp"], ["world.levelCount", "map"]] as const) {
      for (const count of [0, 1, 2]) expect(t(key, { count: String(count) })).toBe(`${count} ${noun}${count === 1 ? "" : "s"}`);
    }
    setLocale("tr");
    for (const count of [0, 1, 2]) expect(t("feedback.cells", { count })).toBe(`${count} hücre`);
  });

  it("formats numeric counts with the active locale rather than preformatted strings", () => {
    for (const id of ["tr", "en"]) {
      setLocale(id);
      expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat(id).format(1234.5));
      expect(t("feedback.cells", { count: "1000" })).toBe(`${new Intl.NumberFormat(id).format(1000)} ${id === "tr" ? "hücre" : "cells"}`);
    }
  });

  it("notifies subscribers once per real locale change, including direct facade calls", () => {
    const listener = vi.fn();
    const stop = subscribeLocale(listener);
    setLocale("en");
    expect(getLocale()).toBe("en");
    setLocale("en");
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    setLocale("tr");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("generates recursive ICU argument types", () => {
    expect(argumentSchema("{count, plural, one {{name}} other {{count, number} {kind, select, a {A} other {B}}}}", "en"))
      .toEqual({ count: "number", kind: "string", name: "string" });
  });

  it("checks the generated key/argument schema is fresh", () => {
    expect(() => execFileSync("node", ["--experimental-strip-types", "scripts/i18n-gen.ts", "--check"], { cwd: new URL("../../", import.meta.url), stdio: "pipe" })).not.toThrow();
  });
});
