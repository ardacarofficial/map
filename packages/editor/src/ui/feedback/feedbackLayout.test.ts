import { describe, expect, it } from "vitest";

import { feedbackPlacement } from "./feedbackLayout";

describe("canvas feedback placement", () => {
  it("centres in a wide canvas even with a minimap", () => {
    expect(feedbackPlacement(1000, 400, 816).center).toBe(500);
  });

  it("shifts left to leave 8 px before the minimap", () => {
    const { center } = feedbackPlacement(700, 400, 516);
    expect(center + 200).toBe(516 - 8);
  });

  it("constrains long feedback to the space before the minimap", () => {
    const { maxWidth, center } = feedbackPlacement(400, 560, 216);
    expect(maxWidth).toBe(196);
    expect(center - maxWidth / 2).toBe(12);
    expect(center + maxWidth / 2).toBe(208);
  });

  it("uses the whole canvas when the minimap is hidden", () => {
    expect(feedbackPlacement(400, 560)).toEqual({ maxWidth: 376, center: 200 });
    expect(feedbackPlacement(1440, 560).center).toBe(720);
  });
});

it('uses the width above the minimap when its side gutter cannot fit feedback actions', () => {
  expect(feedbackPlacement(300, 560, 116)).toEqual({ maxWidth: 276, center: 150 });
});
