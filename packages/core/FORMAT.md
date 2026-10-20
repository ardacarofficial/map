# Editor project storage (document format 6)

The authoring codecs are `src/serialize.ts`. A world uses `project.smap`
(`format: "smap-project"`), one `smap-level` JSON file per map, PNG tilesets,
and `smap-stamp` JSON for stamps and generated recipes. These documents keep
`documentFormatVersion: 6`; existing v1–v5 migrations are unchanged. Game and
engine exports have their own [format specification](src/export/FORMAT.md).

## Recoverable saves

Every individual replacement uses the filesystem adapter's atomic writer
(desktop: temporary file, fsync, rename; browser: writable swap file, close).
A multi-file save additionally protects the entire previous saved set:

1. Copy the old project, **all** its levels (including unopened maps), stamp
   library, recipe sidecars and mutable generated PNGs into `backups/save/`.
   Files are named `<sha256>-<encodeURIComponent(original path)>`. The hash
   covers the sorted pairs of original paths and SHA-256 byte hashes. Existing
   edited PNGs already have immutable content-addressed revision paths and
   remain retained. Ordinary saves never replace existing user source PNGs.
2. Atomically publish the old `project.smap` with its level paths redirected
   to those completed backup copies. Generated PNG references point at
   immutable `tilesets/snapshots/<sha256-of-PNG-bytes>.png` copies. This is an
   ordinary, independently readable project using the existing schema.
3. Write the new PNGs, recipes, stamps and changed levels to their usual paths.
4. Atomically replace `project.smap` with the new metadata. This commits the
   complete new set. Only then remove deleted levels/stamps and temporary
   save backup copies. Cleanup failure does not fail a committed save.

Before opening or retrying a save, a root whose first map points inside
`backups/save/` restores its original levels, generated PNGs, recipes and
stamp library from that completed set. The original project file is restored
last; interruption during recovery can therefore be retried. Stable map ids,
paths and world positions survive recovery. Failure before backup publication
leaves the old root usable; failure before final publication recovers the old
set; a completed final publication uses the new set. Multiple maps cannot
reopen as a mixture of the two saves. `backups/save/` is reserved internal
save protection, not persisted paint history, branching or a crash journal.

## Map backups with historical pixels

`backups/<map>-YYYY-MM-DD_HH-MM-SS.json` now contains a separate backup
envelope, not a change to the document schema:

```jsonc
{
  "format": "smap-backup",
  "backupFormatVersion": 1,
  "project": { /* ordinary smap-project document, version 6 */ },
  "level": { /* ordinary smap-level document, version 6 */ }
}
```

The nested project captures the save's tileset metadata, including edited
atlas geometry, allocated slots, origins and canonical RGBA content hash.
For each tileset referenced by the level palette, its `imagePath` points to
`tilesets/snapshots/<sha256-of-PNG-bytes>.png`. These immutable files retain
the exact PNG bytes for ordinary, generated and edited art. Pixel data is
never duplicated as JSON/raw RGBA. Backup dedup compares the complete
deterministic envelope, so changing only pixels creates a new backup even
when the level JSON is byte-identical. Saves in the same second receive
consecutive timestamp seconds instead of overwriting one another.

Opening a backup verifies each retained PNG's byte hash, and additionally
verifies edited raster dimensions and canonical RGBA hash. Historical
tilesets receive deterministic independent `restored-<sha256>` ids (with a
suffix for any occupied metadata or raster identity, including slots retained
by another map or undo); palette references are remapped
when parsing the restored level. Live world tilesets and shared raster slots
stay intact. Historical generated art is frozen as an ordinary tileset so
today's source regeneration cannot change its pixels. The restored map is
dirty and uses the normal save pipeline. The snapshot PNG namespace is excluded
from both PNG apply and PNG restore targets, including the guarded writer, so
later explicit file actions cannot overwrite a retained revision. Old level-only backups still open
with current project metadata; historical pixels cannot be inferred for
backups made before this envelope existed.

Rotation keeps the newest ten backup envelopes per map. PNG revisions are
conservatively retained, including snapshots and old edited revisions;
rotation and save cleanup never remove them. Garbage collection requires
accounting for all live maps, kept backups and in-memory history and is not
performed by these writers. The auxiliary envelope has its own version
because it combines existing v6 documents without adding document fields;
no document v7 or migration is needed.
