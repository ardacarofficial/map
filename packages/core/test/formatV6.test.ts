import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { migrateV6, normalizeCollection, collectionProblem, serializeProject, parseProject, parseColorPalette, serializeColorPalette } from '../src';
import { makeStore } from './helpers';

describe('format 6', () => {
  it('migrates rows without modifying input, including oversized legacy layouts', () => {
    const input = { documentFormatVersion: 5, collections: [{ id: 'a', name: 'A', columns: 8, cells: [{ x: 0, y: 500, tilesetId: 't', tileId: 0 }] }] };
    const before = JSON.stringify(input);
    const migrated = migrateV6(input);
    expect(migrated.collections).toEqual([{ ...input.collections[0], rows: 502 }]);
    expect(JSON.stringify(input)).toBe(before);
    const text = JSON.stringify({ format: 'smap-project', name: 'P', levels: [], tilesets: [], ...input });
    const project = parseProject(text);
    expect(project.collections[0]!.rows).toBe(502);
    expect(serializeProject(parseProject(serializeProject(project)))).toBe(serializeProject(project));
  });
  it('bounds explicit rows, capacity and occupied references', () => {
    const c = { id: 'a', name: 'A', columns: 2, rows: 2, cells: [{ x: 0, y: 2, tilesetId: 't', tileId: 0 }] };
    expect(collectionProblem(c)).toMatch(/row|bounds/);
    expect(collectionProblem({ ...c, cells: [], rows: 257 })).toMatch(/rows/);
    expect(normalizeCollection({ ...c, rows: 3 }).rows).toBe(3);
  });
  it('collection dimensions survive random undo/redo sequences', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 256 }), { minLength: 1, maxLength: 30 }), rows => {
      const { store } = makeStore();
      for (const n of rows) store.dispatch({ type: 'setCollection', collection: { id: 'a', name: 'A', columns: 2, rows: n, cells: [] } });
      const end = JSON.stringify(store.document.collections);
      while (store.undo()) { /* replay below */ }
      expect(store.document.collections).toEqual([]);
      while (store.redo()) { /* restore */ }
      expect(JSON.stringify(store.document.collections)).toBe(end);
    }));
  });
  it('normalizes colour palettes in project and versioned portable files', () => {
    const p = { name: 'Evening', colors: ['#AABBCC00', '#123456ff'] };
    expect(parseColorPalette(serializeColorPalette(p))).toEqual({ ...p, colors: ['#aabbcc00', '#123456ff'] });
    const text = serializeProject({ name: 'P', levels: [], tilesets: [], colorPalettes: [p] });
    expect(serializeProject(parseProject(text))).toBe(text);
    expect(() => parseColorPalette('{"version":2,"name":"x","colors":[]}')).toThrow();
  });
});

it('refuses implicit v6 rows and invalid project colour palettes', () => {
  const root={format:'smap-project',documentFormatVersion:6,name:'P',levels:[],tilesets:[],collections:[{id:'a',name:'A',columns:2,cells:[]}]};
  expect(()=>parseProject(JSON.stringify(root))).toThrow(/rows/);
  expect(()=>parseProject(JSON.stringify({...root,collections:[{...root.collections[0],rows:null}]}))).toThrow(/rows/);
  expect(()=>parseProject(JSON.stringify({...root,collections:[],colorPalettes:null}))).toThrow(/colorPalettes/);
});

it('retains and shrinks legacy oversize layouts, rejecting growth or occupied clipping', () => {
  const {store}=makeStore();
  const legacy=normalizeCollection({id:'legacy',name:'Legacy',columns:2,rows:502,cells:[{x:0,y:500,tilesetId:'grass',tileId:0}]});
  // This is a parsed project fixture, rather than a newly created oversize collection.
  const project=parseProject(JSON.stringify({format:'smap-project',documentFormatVersion:5,name:'P',levels:[],tilesets:store.document.tilesets,collections:[legacy]}));
  store.document._setCollections(project.collections);
  store.dispatch({type:'setCollection',collection:{...project.collections[0]!,name:'Renamed'}});
  expect(()=>store.dispatch({type:'setCollection',collection:{...legacy,rows:503}})).toThrow(/rows/);
  expect(()=>store.dispatch({type:'setCollection',collection:{...legacy,rows:500}})).toThrow(/bounds/);
  store.dispatch({type:'setCollection',collection:{...legacy,rows:501}});
  expect(store.document.collections[0]!.rows).toBe(501);
  store.undo();expect(store.document.collections[0]!.rows).toBe(502);
});

it('does not allow implicit rows to grow a retained legacy collection', () => {
  fc.assert(fc.property(fc.integer({min:258,max:4000}),fc.integer({min:0,max:10}),(rows,growth)=>{
    const {store}=makeStore();
    const legacy=normalizeCollection({id:'legacy',name:'Legacy',columns:2,rows,cells:[{x:0,y:rows-2,tilesetId:'grass',tileId:0}]});
    store.document._setCollections([legacy]);
    expect(()=>store.dispatch({type:'setCollection',collection:{id:'legacy',name:'Legacy',columns:2,cells:[{x:0,y:rows+growth,tilesetId:'grass',tileId:0}]}})).toThrow(/rows/);
    expect(store.document.collections).toEqual([legacy]);
  }),{numRuns:40});
});
