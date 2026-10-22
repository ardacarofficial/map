---
name: harita-map-authoring
description: Design and refine editable tile maps in a live Harita editor through its MCP tools. Use for map composition, art discovery, shared region work, visual validation and human-reviewed edits.
---

# Harita map authoring

Use the connected editor as the source of truth. Start with `get_session` and `get_editor_context`, inspect the target map and discover the user's actual art. Read [the overview](harita://guide/overview), then load only the guide sections relevant to the next step. MCP resources expose the same documents as this repository's [guide directory](../../../packages/agent/guide/overview.md).

Make a result the user can keep editing: a readable composition, meaningful names, a manageable semantic layer stack, and reusable stamps where useful. Reuse suitable existing layers. More layers are justified by editing roles and visual behavior, rather than one layer per object or collaborator. These are design principles, not a fixed layer count or prescribed art style.

- [Plan intent, structure and names](harita://guide/planning).
- [Inspect native art and grids](harita://guide/assets).
- [Choose painting, stamps, smart sources and manual collision](harita://guide/painting).
- [Coordinate a shared draft and region boundaries](harita://guide/collaboration).
- [Review previews, data and explicit goals](harita://guide/validation).
- [Navigate panels and application controls](harita://guide/editor).
- [Use transaction/revision ownership, recovery and human review](harita://guide/workflow).

The tool catalogue defines current schemas and limits. Use typed document tools for changes, explicit UI setters for preferences, and the shared-draft contract when contributing alongside peers. Inspect the rendered result and correct it before submitting. An agent cannot approve its own work; finishing a contribution is a handoff for human review.
