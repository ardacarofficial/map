import { afterEach, expect, it, vi } from "vitest";

import { browserPlatform, setPlatform } from "./index";
import { refreshRecentProjects } from "./recentProjects";

afterEach(() => setPlatform(browserPlatform));

it("refreshes again when the deferred picture lands during a pending list read", async () => {
  let finish!: (entries: []) => void;
  const list = vi.fn().mockImplementationOnce(() => new Promise<[]>((resolve) => { finish = resolve; })).mockResolvedValue([]);
  setPlatform({ ...browserPlatform, recents: { ...browserPlatform.recents, supported: true, list } });
  const first = refreshRecentProjects();
  const updated = refreshRecentProjects();
  finish([]);
  await Promise.all([first, updated]);
  expect(list).toHaveBeenCalledTimes(2);
});
