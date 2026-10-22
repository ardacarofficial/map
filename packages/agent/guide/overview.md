# Harita: start here

Harita is a live tile-map editor. A **world** contains named maps, shared art and reusable stamps. The user keeps editing the result after your contribution, so favor a clear composition and an understandable document structure.

Start with `get_session` and `get_editor_context`. Inspect the requested map with `get_map_info`; use the user's selection and viewport as context, without assuming they define the entire task. Discover actual artwork before choosing tiles. Sketch a practical layer and placement plan, implement a bounded contribution, inspect the rendered result, and submit it for human review. Adapt the depth of planning and validation to the request.

Read only the sections needed next:

- [Planning and editable layers](harita://guide/planning)
- [Art discovery and tile grids](harita://guide/assets)
- [Painting, stamps and manual collision](harita://guide/painting)
- [Collaborating on a common draft](harita://guide/collaboration)
- [Visual and structural review](harita://guide/validation)
- [Editor and application controls](harita://guide/editor)
- [Transactions, recovery and human review](harita://guide/workflow)

The MCP tool catalogue is the authority for current arguments and limits. These guides supply authoring judgment and workflow context. Their examples are starting points, not a mandatory style or a fixed layer budget.
