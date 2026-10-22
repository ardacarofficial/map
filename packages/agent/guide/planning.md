# Plan a map the user can keep editing

Infer a useful plan from the request and available art: purpose, approximate scale, important entrances and destinations, circulation, landmarks, and the areas that should remain open. Ask about missing intent when it would change the result materially; resolve routine artistic choices yourself. A small decoration change needs less ceremony than a new village.

Read `get_map_info` and relevant `read_region` rectangles before changing an existing map. Preserve its conventions and recognizable work. Describe the intended result and a few observable checks, such as a connected entrance-to-square route or an unobstructed doorway. When preservation matters, capture a `validate_goals` `region_unchanged` baseline before editing.

## Use layers for editing roles

Inspect the existing stack and reuse suitable layers. Add a layer when it needs independent visibility, ordering, collision behavior or later editing. A semantic stack might contain **Ground**, **Water & banks**, **Paths**, **Structures**, **Details**, **Collision**, and **Gameplay**. This is an example, not a required template or maximum: some maps need fewer roles, and a large interior or foreground treatment may justify more.

Avoid creating a layer per tree, house, placement batch or collaborator. Objects usually belong on shared functional layers; reusable arrangements belong in named stamps. Give layers names the user will recognize later, following the user's language and existing naming style. For a complex stack, consistent name families can convey related roles. There is no layer-group tool to invent: `edit_layer` supports create, update and reorder, with zero-based indices from bottom to top. It does not delete or merge layers.

Create needed layers deliberately with `edit_layer` and keep their returned IDs. Use explicit existing layer mappings for stamps. Before inviting collaborators, agree on the shared stack and region boundaries; see [collaboration](harita://guide/collaboration).

## Build readable composition

Establish broad surfaces and routes before dense decoration. Check the main silhouette and traversable space at overview scale, then add enough variation to support the setting. Repetition can provide rhythm, while landmarks, clear entrances and coherent edges make the map readable. Match the requested style: restrained detail and dense scenes are both valid when intentional.

Map names should describe their role or place. `edit_map` changes names and world positions while retaining stable IDs. `configure_world` changes defaults for future maps; it does not resize existing maps. Return a result whose layer names, stamps and route layout explain how to continue editing it.
