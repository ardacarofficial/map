// eslint-disable-next-line no-restricted-imports -- frozen on-disk regression corpus
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseProject, parseLevel, parseStamp, serializeProject, serializeLevel, serializeStamp, migrateV6 } from '../src';
import { decodePng } from './png';
import { pixelHash } from './pixelOracle';
const root = decodeURIComponent(import.meta.url.replace(/^file:\/\//, '')).replace(/\/[^/]*$/, '') + '/fixtures/';
const read = (path: string) => readFileSync(root + path, 'utf8');
function freeze(value: unknown): void { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
for (const version of [4,5]) it(`v${version} frozen cells, flags, recipes, PNG references and rendered pixels survive v6`, () => {
  const paths = version === 4 ? ['v16-selection/project.smap','v16-selection/main.json','v16-selection/recipe.json'] : ['v6-upgrade/v5-project.smap','v6-upgrade/v5-main.json','v6-upgrade/v5-recipe.json'];
  const projectText=read(paths[0]!), levelText=read(paths[1]!), stampText=read(paths[2]!);
  const rawProject=JSON.parse(projectText), rawLevel=JSON.parse(levelText), rawStamp=JSON.parse(stampText);
  freeze(rawProject); const original=JSON.stringify(rawProject);
  expect(migrateV6(rawProject).tilesets).toEqual(rawProject.tilesets);
  expect(JSON.stringify(rawProject)).toBe(original);
  const p=parseProject(projectText), doc=parseLevel(levelText,p.tilesets), stamp=parseStamp(stampText,p.tilesets);
  const saved=serializeLevel(doc), next=JSON.parse(saved);
  expect(next.layers).toEqual(rawLevel.layers); expect(next.palette).toEqual(rawLevel.palette);
  expect(JSON.parse(serializeStamp(stamp))).toEqual({...rawStamp,documentFormatVersion:6});
  expect(p.tilesets.map(t=>t.imagePath)).toEqual(rawProject.tilesets.map((t:{imagePath:string})=>t.imagePath));
  expect(p.tilesets.map(t=>t.generated)).toEqual(rawProject.tilesets.map((t:{generated?:unknown})=>t.generated));
  const images=new Map(p.tilesets.map(t=>[t.id,decodePng(readFileSync(root+'v16-selection/'+(t.generated?'baked.png':'source.png')))]));
  const expectedDoc=parseLevel(read('v16-selection/main.json'),parseProject(read('v16-selection/project.smap')).tilesets);
  expect(pixelHash(doc,images)).toBe(pixelHash(expectedDoc,images));
  expect(serializeProject(parseProject(serializeProject(p)))).toBe(serializeProject(p));
  expect(serializeLevel(parseLevel(saved,p.tilesets))).toBe(saved);
});
