import fc from "fast-check";
import { expect, it } from "vitest";
import { BLOB47_MASKS, flipBlobMask, reduceBlobMask, buildLayout1RoadProfile, roadProfileProblem, composeOrientation, FLIP_H, FLIP_V, FLIP_D } from "../../src";

it("reduces all 256 neighbour masks to 47 idempotent masks and commutes with every D4 orientation", () => {
  expect(new Set(Array.from({length:256},(_,i)=>reduceBlobMask(i))).size).toBe(47);
  fc.assert(fc.property(fc.integer({min:0,max:255}),fc.integer({min:0,max:7}),fc.integer({min:0,max:7}),(mask,a,b)=>{
    const flags=(n:number)=>((n&1?FLIP_H:0)|(n&2?FLIP_V:0)|(n&4?FLIP_D:0))>>>0;
    const apply=(m:number,f:number)=>flipBlobMask(m,!!(f&FLIP_H),!!(f&FLIP_V),!!(f&FLIP_D));
    expect(reduceBlobMask(reduceBlobMask(mask))).toBe(reduceBlobMask(mask));
    expect(reduceBlobMask(apply(mask,flags(a)))).toBe(apply(reduceBlobMask(mask),flags(a)));
    expect(apply(apply(mask,flags(a)),flags(b))).toBe(apply(mask,composeOrientation(flags(a),flags(b))));
  }));
});

it("every layout-1 family has all 47 masks, stable source/cap slots and immutable ordered variants", () => {
  fc.assert(fc.property(fc.integer({min:3,max:12}),fc.integer({min:3,max:12}),(w,h)=>{
    const profile=buildLayout1RoadProfile(w,h), bank=w*h+w+h+1;
    expect(roadProfileProblem(profile)).toBeNull();
    expect(profile.tiles.filter(t=>t.tileId>=bank).map(t=>t.mask)).toEqual(BLOB47_MASKS);
    expect(profile.tiles.map(t=>t.tileId)).toEqual(Array.from({length:bank+47},(_,i)=>i));
    expect(Object.isFrozen(profile.tiles[0])).toBe(true);
    expect(roadProfileProblem({tiles:profile.tiles.filter(t=>t.mask!==0)})).toMatch(/47/);
  }));
});
