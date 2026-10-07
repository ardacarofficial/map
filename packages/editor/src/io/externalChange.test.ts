import { describe, expect, it } from "vitest";
import { compareDisk } from "./externalChange";

describe("compareDisk", () => {
  it("detects a different file on disk", () => {
    expect(compareDisk('{"a":1}\n', '{"a":1}\n')).toBe("same");
    expect(compareDisk('{"a":2}\n', '{"a":1}\n')).toBe("changed");
  });
  it("ignores line-ending rewrites (git on Windows)", () => {
    expect(compareDisk('{\r\n"a":1\r\n}\r\n', '{\n"a":1\n}\n')).toBe("same");
  });
  it("has nothing to compare before the first read/write", () => {
    expect(compareDisk("anything", null)).toBe("same");
  });
  it("reports a deleted file separately", () => {
    expect(compareDisk(null, "x")).toBe("missing");
  });
});
