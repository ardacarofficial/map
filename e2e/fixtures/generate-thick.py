"""Regenerate deterministic offset road artwork (stdlib only). Run from the worktree root."""
import pathlib
import struct
import zlib


def png(path, size, w=6, h=6, mode="border"):
    width, height = 12 * size, 8 * size
    rows = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            u, v = x - 2 * size, y - size
            if 0 <= u < w * size and 0 <= v < h * size:
                distance = min(u, v, w * size - 1 - u, h * size - 1 - v)
                value = min(180, 40 + distance * 140 // (2 * size))
                # Texture repeats per tile; off-centre marker makes source flips observable.
                marker = 11 if (u % size, v % size) == (3, 5) else 0
                if mode == "texture":
                    # Review repro: a globally repeating 3×3 motif, no outside border.
                    value = 120 if u % size in (0, size-1) or v % size in (0, size-1) else 40 + (u // size % 3) * 35 + (v // size % 3) * 20
                    row.extend((value, value, value, 255))
                elif mode == "brick":
                    # Opaque running-bond masonry: continuous periodic material, no frame.
                    mortar = v % 12 < 2 or (u + (16 if v // 12 % 2 else 0)) % 32 < 2
                    row.extend((105, 100, 90, 255) if mortar else (152 + (u+v) % 7, 72, 49, 255))
                elif mode == "warehouse":
                    # Opaque object with roof, siding, windows and an off-centre door.
                    colour = (76, 68, 58) if v < size else (145, 123, 93)
                    if v >= size and v % 6 == 0:
                        colour = (116, 95, 72)
                    if 2*size < v < 3*size and u % (2*size) < size:
                        colour = (51, 91, 110)
                    if 4*size < v and 3*size < u < 4*size:
                        colour = (61, 47, 35)
                    row.extend((*colour, 255))
                else:
                    row.extend((value + marker, value + (u % size + v % size) % 3, value + 10, 255))
            else:
                row.extend((0, 0, 0, 0))
        rows.append(b'\0' + row)
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    pathlib.Path(path).write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b''))


for tile_size in (16, 32):
    png(f'e2e/fixtures/smart-road-{tile_size}-thick.png', tile_size)
png('e2e/fixtures/smart-road-32-thick-wide.png', 32, 8, 6)

png('e2e/fixtures/smart-road-32-thick-odd.png', 32, 7, 6)
for mode in ('texture', 'brick', 'warehouse'):
    png(f'e2e/fixtures/smart-object-16-{mode}.png', 16, mode=mode)
