# Sample sheet provenance

These PNGs are ordinary tilesets. Their filenames record the historical
reference layouts used to draw the sample artwork; they do not enable a
tagging mode or brush in the editor.

- `blob47-godot-32.png`: Godot 3 “3x3 minimal” reference layout
  (`tutorials/2d/img/autotile_template_3x3_minimal.png` in godot-docs).
- `blob47-cr31-32.png`: cr31’s 7×7 reference sheet
  (`cr31.co.uk/stagecast/wang/blob.html`, reference image `wangbl.png`).
- `blob47-32.png`: historical ascending reduced-mask order.
- `wang16-32.png`: 16 corner-Wang combinations, NE/SE/SW/NW bits 1/2/4/8.

Per-sheet Markdown files retain the original artwork, dimensions and slot
tables for reproducibility. Paint these images using ordinary tile selection
and stamps. Collision is painted separately on a manual Collision layer.
