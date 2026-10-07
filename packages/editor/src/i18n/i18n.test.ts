import { describe, expect, it } from "vitest";

import { en } from "./en";
import { tr } from "./tr";

function shape(messages: object): string[] {
  return Object.entries(messages)
    .flatMap(([section, entries]) => Object.keys(entries as object).map((key) => `${section}.${key}`))
    .sort();
}

function placeholders(messages: object): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [section, entries] of Object.entries(messages)) {
    for (const [key, text] of Object.entries(entries as Record<string, string>)) {
      out[`${section}.${key}`] = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
    }
  }
  return out;
}

describe("translations", () => {
  it("en has exactly the keys of tr", () => {
    expect(shape(en)).toEqual(shape(tr));
  });

  it("en uses the same placeholders as tr", () => {
    expect(placeholders(en)).toEqual(placeholders(tr));
  });

  it("has no empty strings", () => {
    for (const messages of [tr, en]) {
      for (const entries of Object.values(messages)) {
        for (const text of Object.values(entries as Record<string, string>)) expect(text.length).toBeGreaterThan(0);
      }
    }
  });
});
