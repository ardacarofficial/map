# Navigate and configure the live editor

`get_editor_state` reads current tools, brush/rectangle/selection options, atlas filters, colors, view controls, layout, locale and effective/default shortcuts. `list_editor_commands` discovers real registered command IDs, current enabled/check states and `remoteExecutable` permission. A familiar name or category is not permission to execute a document command.

Use the controls relevant to the task:

| Tool | Useful controls |
| --- | --- |
| `configure_editor` | Active map/layer and existing art/entity selection; tool/mode and brush options; grid/collision/minimap/rulers; camera; atlas view/filter/zoom; pixel tool preferences/colors/mirrors |
| `configure_layout` | Show, hide, move or reorder panels; split groups; resize and expand/collapse/hide dock zones; reset layout |
| `configure_application` | Persist available locale and validated shortcut overrides; `null` restores a default, `[]` unbinds |
| `get_export_settings`, `configure_export` | Remembered target, scale and supported export preferences; no destination selection or file delivery |
| `run_editor_command` | An enabled command explicitly advertised as remotely executable, including supported settings inspectors |

These are UI preferences and navigation, independent of document proposal revisions and undo. They remain available during pending AI review where they do not conflict with an active gesture or settings draft. World/map settings can be opened for inspection; their conflicting mutation controls remain read-only until review resolves. Application language and panel preferences can still change. Read-only inspection does not grant permission to approve the agent's own proposal.

Use optional `{context:{worldSessionId}}` when a UI request should bind to the current world. Prefer explicit setters for retryable navigation and preferences: command toggles are not replay-cached. Camera centers and marquees use target-map cells; `camera.center` requires level view, and `frame:true` excludes explicit center/zoom. Camera animation may settle after a reply.

Document changes use typed transaction tools, such as `edit_map`, `edit_layer` and `configure_world`. Settings inspectors do not provide a generic bypass. Source PNG writing, arbitrary paths/shell, file dialogs, tileset import/regridding and other unadvertised workflows remain human actions. Each native world window owns its own endpoint and draft; inspect the correct session before working.
