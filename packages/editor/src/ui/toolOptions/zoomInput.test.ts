import { expect, it } from "vitest";
import { formatZoomLabel, formatZoomPercent, zoomPercentAffixes } from "./zoomInput";

it("formats zoom decimals for any discovered locale without grouping or a percent sign", () => {
  expect(formatZoomPercent(0.125, "tr")).toBe("12,5");
  expect(formatZoomPercent(0.125, "en")).toBe("12.5");
  expect(formatZoomPercent(0.125, "pl")).toBe("12,5");
  expect(formatZoomPercent(16, "en")).toBe("1600");
});

it("formats complete zoom labels using the selected language's percent convention", () => {
  expect(formatZoomLabel(0.125, "tr")).toBe("%12,5");
  expect(formatZoomLabel(0.125, "en")).toBe("12.5%");
  expect(formatZoomLabel(0.125, "pl")).toBe("12,5%");
  expect(formatZoomLabel(0.125, "de")).toBe("12,5\u00a0%");
});

it("keeps a percent unit in the editable field for additional languages", () => {
  expect(zoomPercentAffixes("tr")).toEqual({ prefix: "%", suffix: "" });
  expect(zoomPercentAffixes("en")).toEqual({ prefix: "", suffix: "%" });
  expect(zoomPercentAffixes("pl")).toEqual({ prefix: "", suffix: "%" });
  expect(zoomPercentAffixes("de")).toEqual({ prefix: "", suffix: "\u00a0%" });
});
