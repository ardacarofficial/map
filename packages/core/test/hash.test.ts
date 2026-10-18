// eslint-disable-next-line no-restricted-imports -- baseline byte oracle is test-only
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { cellHash, pickVariant, pickRandomTile, pickRandomCandidate, type RandomSet } from "../src";

it("retains e94d93d random brush and saved-set output byte-for-byte, including negative chunk boundaries", () => {
  const set=[{tilesetId:"a",tileId:0,weight:0.5},{tilesetId:"b",tileId:1,weight:2},{tilesetId:"b",tileId:2,weight:0},{tilesetId:"a",tileId:3}];
  const saved: RandomSet={id:"random",name:"Random",candidates:set.map(t=>({kind:"tile",...t})),scatter:0.2,chunk:{w:3,h:2},randomFlip:true};
  const samples=[];
  for(const seed of [0,1,42,0xffffffff]) for(let y=-33;y<=33;y+=3) for(let x=-33;x<=33;x+=3) samples.push([cellHash(seed,x,y),pickVariant(7,seed,x,y),pickRandomTile(set,seed,x,y),pickRandomCandidate(saved,seed,x,y)]);
  // Computed by running the unmodified e94d93d hash/randomBrush/randomSet source, independently of migrations.
  expect(createHash("sha256").update(JSON.stringify(samples)).digest("hex")).toBe("526cceaf3a223f06d23f1d05bb88d18dae46abe5af4f240511a8faf36ef58d09");
});
