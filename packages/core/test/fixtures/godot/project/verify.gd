extends SceneTree

func fail(message: String) -> bool:
	push_error(message)
	return false

func _initialize() -> void:
	call_deferred("verify")

func verify() -> void:
	if not verify_sequential() or not verify_native():
		quit(1)
		return
	var packed = load("res://smap/fixture/fixture.tscn") as PackedScene
	if packed == null:
		fail("Scene did not load")
		quit(1)
		return
	var map = packed.instantiate() as Node2D
	root.add_child(map)
	if not verify_data(map):
		quit(1)
		return
	var collision = map.get_child(3) as TileMapLayer
	collision.update_internals()
	await physics_frame
	await physics_frame
	var query = PhysicsPointQueryParameters2D.new()
	query.collision_mask = 1
	query.position = Vector2(40, 56) # Solid, no visual artwork at cell (2,3).
	var hits = map.get_world_2d().direct_space_state.intersect_point(query)
	if hits.is_empty():
		fail("Missing physics at collision-only cell")
		quit(1)
		return
	query.position = Vector2(8, 8) # Lower solid was explicitly made passable above.
	if not map.get_world_2d().direct_space_state.intersect_point(query).is_empty():
		fail("Passable override still has physics")
		quit(1)
		return
	print("GODOT_EXPORT_OK: sources, atlas, D4, sparse cells, metadata, layer props, polygon and physics queries")
	quit(0)

func verify_data(map: Node2D) -> bool:
	if map.get_child_count() != 4:
		return fail("Expected three visual layers and one collision layer")
	var ground = map.get_child(0) as TileMapLayer
	var deco = map.get_child(1) as TileMapLayer
	var empty = map.get_child(2) as TileMapLayer
	var collision = map.get_child(3) as TileMapLayer
	if empty.name != "Empty (2) + 🌲":
		return fail("Valid punctuation/Unicode node name changed")
	if ground.get_used_cells().size() != 8 or not empty.get_used_cells().is_empty():
		return fail("Sparse/empty cells changed")
	for i in range(8):
		var cell = Vector2i(i * 2, 0)
		if ground.get_cell_source_id(cell) != 0 or ground.get_cell_atlas_coords(cell) != Vector2i(1,1) or ground.get_cell_alternative_tile(cell) != i * 4096:
			return fail("Bad cell source/atlas/alternative at %s" % cell)
		if ground.get_cell_source_id(cell + Vector2i(1,0)) != -1:
			return fail("Sparse hole was filled")
	if deco.get_cell_source_id(Vector2i(3,2)) != 1 or deco.get_cell_atlas_coords(Vector2i(3,2)) != Vector2i(0,1):
		return fail("Second source failed")
	if deco.visible or deco.modulate.a != 0.25 or ground.texture_filter != CanvasItem.TEXTURE_FILTER_NEAREST:
		return fail("Layer visibility/opacity/filter failed")
	if ground.get_meta("smap_layer_name") != "Ground \"road\"\n\\":
		return fail("Escaped original name changed")
	var tiles = ground.tile_set
	if tiles.get_source_count() != 3 or tiles.tile_size != Vector2i(16,16):
		return fail("Shared TileSet sources/size failed")
	var source = tiles.get_source(0) as TileSetAtlasSource
	if source.margins != Vector2i(1,1) or source.separation != Vector2i(2,2) or source.texture_region_size != Vector2i(16,16) or source.get_tiles_count() != 1:
		return fail("Atlas geometry/used tile entries failed")
	if source.resource_name != "Atlas \"road\"\n\\":
		return fail("Escaped resource name changed")
	if collision.get_used_cells() != [Vector2i(2,3)] or collision.get_cell_source_id(Vector2i(2,3)) != 2:
		return fail("Collision decision failed")
	var data = collision.get_cell_tile_data(Vector2i(2,3))
	if data == null or data.get_collision_polygons_count(0) != 1 or data.get_collision_polygon_points(0,0) != PackedVector2Array([Vector2(-8,-8),Vector2(8,-8),Vector2(8,8),Vector2(-8,8)]):
		return fail("Collision polygon failed")
	var texture = (tiles.get_source(2) as TileSetAtlasSource).texture
	if texture.get_image().get_pixel(8,8).a != 0.0:
		return fail("Collision artwork is opaque")
	if ground.collision_enabled or not collision.collision_enabled:
		return fail("Collision layer isolation failed")
	return true

func verify_sequential() -> bool:
	for entry in [["41", Color.RED, 2], ["42", Color.BLUE, 1]]:
		var scene = load("res://smap/Same--id-%s/Same.tscn" % entry[0]) as PackedScene
		if scene == null:
			return fail("Sequential scene failed to load: " + entry[0])
		var map = scene.instantiate()
		var layer = map.get_child(0) as TileMapLayer
		var source = layer.tile_set.get_source(layer.get_cell_source_id(Vector2i.ZERO)) as TileSetAtlasSource
		if not source.texture.get_image().get_pixel(0,0).is_equal_approx(entry[1]):
			return fail("Sequential export changed artwork: " + entry[0])
		if (map.get_child(1) as TileMapLayer).get_cell_source_id(Vector2i(0,1)) != entry[2]:
			return fail("Sequential export changed collision source: " + entry[0])
		map.free()
	print("GODOT_SEQUENTIAL_OK: A red and B blue, distinct textures and collision source ids")
	return true

func verify_native() -> bool:
	var scene = load("res://smap/native/native.tscn") as PackedScene
	if scene == null:
		return fail("Native scene failed to load")
	var map = scene.instantiate()
	var layer = map.get_child(0) as TileMapLayer
	var sizes = [Vector2i(16,16), Vector2i(32,32), Vector2i(48,64), Vector2i(16,48), Vector2i(17,35)]
	for row in range(sizes.size()):
		for flags in range(8):
			var cell = Vector2i(flags * 3, row * 4 + 2)
			var alternative = flags * 4096 if row == 1 else flags
			if layer.get_cell_source_id(cell) != row or layer.get_cell_atlas_coords(cell) != Vector2i(1,1) or layer.get_cell_alternative_tile(cell) != alternative:
				return fail("Native cell source/atlas/alternative mismatch")
			var source = layer.tile_set.get_source(row) as TileSetAtlasSource
			if not source.has_alternative_tile(Vector2i(1,1), alternative):
				return fail("Missing native alternative")
			var data = source.get_tile_data(Vector2i(1,1), alternative)
			if row == 2 and flags == 0 and data.texture_origin != Vector2i(-8,16):
				return fail("Oversized native origin changed")
	map.free()
	print("GODOT_NATIVE_OK: mixed 16/32, oversized, rectangular and odd native extents; eight orientations")
	return true
