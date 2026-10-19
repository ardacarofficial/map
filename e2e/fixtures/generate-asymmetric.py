"""Author asymmetric seam decorations on the committed paths (Pillow, authoring only)."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).parent
for size in (16, 32):
    for material in ("pebbles", "moss"):
        image = Image.open(root / f"smart-road-{size}.png").convert("RGBA")
        draw = ImageDraw.Draw(image)
        # A grass blade on only the north edge: asymmetric edge detail, with
        # unchanged boundary pixels so translating the edge still joins cleanly.
        draw.line((3*size+2, size+size//4, 3*size+2, size+size//2-1), fill=(57, 99, 43, 255))
        # The centre repeats by translation. Decorations touch its left seam's
        # inner profile, never its seam pixel; the opposite profile is different.
        x, y = 3 * size, 2 * size
        scale = size // 16
        for dx, dy, w, h in ((1, 4, 2, 3), (1, 9, 3, 2), (9, 6, 3, 2), (6, 12, 2, 2)):
            box = (x + (1 if dx == 1 else dx*scale), y + dy*scale, x + (dx+w)*scale-1, y + (dy+h)*scale-1)
            shadow, body, light = ((79, 75, 62), (133, 127, 104), (188, 179, 147)) if material == "pebbles" else ((47, 73, 38), (75, 108, 48), (118, 139, 66))
            draw.rectangle(box, fill=(*shadow, 255))
            draw.rectangle((box[0], box[1], box[2]-scale, box[3]-scale), fill=(*body, 255))
            draw.point((box[0], box[1]), fill=(*light, 255))
        image.save(root / f"smart-road-{size}-asymmetric-{material}.png", optimize=True)
