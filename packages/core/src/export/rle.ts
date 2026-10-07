/**
 * Run-length encoding of a 0/1 grid (collision export).
 *
 * Runs alternate between 0 and 1 and always start with a run of 0s (which
 * may be empty): `[0, 0, 1, 1, 1, 0]` → `[2, 3, 1]`; `[1, 1]` → `[0, 2]`.
 * The runs sum to the grid length. Any non-zero byte counts as 1.
 */

/** Runs of `data` (see module docs). An empty grid yields `[]`. */
export function encodeRle(data: Uint8Array): number[] {
  const runs: number[] = [];
  let current = 0;
  let length = 0;
  for (let i = 0; i < data.length; i++) {
    const bit = data[i] === 0 ? 0 : 1;
    if (bit === current) {
      length++;
    } else {
      runs.push(length);
      current = bit;
      length = 1;
    }
  }
  if (data.length > 0) runs.push(length);
  return runs;
}

/**
 * Expands runs back to a 0/1 grid of `length` cells.
 * @throws RangeError when a run is not a non-negative integer or the runs do not sum to `length`.
 */
export function decodeRle(runs: readonly number[], length: number): Uint8Array {
  const out = new Uint8Array(length);
  let pos = 0;
  runs.forEach((run, i) => {
    if (!Number.isInteger(run) || run < 0) throw new RangeError(`run ${i} must be a non-negative integer, got ${run}`);
    if (pos + run > length) throw new RangeError(`runs exceed the grid length ${length}`);
    if (i % 2 === 1) out.fill(1, pos, pos + run);
    pos += run;
  });
  if (pos !== length) throw new RangeError(`runs cover ${pos} cells, expected ${length}`);
  return out;
}
