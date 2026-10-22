import { expect, it, vi } from "vitest";
import { harness, stamp, success } from "./helpers";

it("fingerprints only the requested page when stamp metadata proves the query match", async () => {
  const h = harness({ stamps: Array.from({ length: 1000 }, (_, i) => ({
    ...stamp, id: `house-${i}`, name: `Village house ${i}`,
  })) });
  const fingerprint = vi.spyOn(h.host.images, "stampFingerprint");
  const first = success(await h.read("list_stamps", { query: "village", limit: 16 }));
  expect((first.data as { items: { id: string }[] }).items[0]!.id).toBe("house-0");
  expect((first.data as { items: unknown[] }).items).toHaveLength(16);
  expect(fingerprint).toHaveBeenCalledTimes(16);

  const cursor = (first.data as { nextCursor: string }).nextCursor;
  const second = success(await h.read("list_stamps", { query: "village", limit: 16, cursor }));
  expect((second.data as { items: { id: string }[] }).items[0]!.id).toBe("house-16");
  expect(fingerprint).toHaveBeenCalledTimes(32);
});
