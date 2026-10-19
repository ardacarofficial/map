import { expect, it, vi } from "vitest";
import type * as I18n from "../i18n";

const selected = vi.hoisted(() => ({ locale: "tr" }));
vi.mock("../i18n", async importOriginal => ({
  ...await importOriginal<typeof I18n>(),
  getLocale: () => selected.locale,
}));
import { formatClock } from "./exportActions";

it("uses the selected locale for clocks while preserving built-in output", () => {
  const date = new Date("2026-10-19T13:04:00Z");
  const options = { hour: "2-digit", minute: "2-digit" } as const;
  for (const locale of ["tr", "en", "pl"]) {
    selected.locale = locale;
    expect(formatClock(date)).toBe(date.toLocaleTimeString(locale, options));
    if (locale !== "pl") expect(formatClock(date)).toBe(date.toLocaleTimeString(locale === "tr" ? "tr-TR" : "en-US", options));
  }
});
