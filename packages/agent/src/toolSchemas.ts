/** Frozen v2 catalogue. Each published input schema contains all local definitions. */
import type { AgentToolDefinition } from "./contracts.ts";

const SHARED_DEFS = {
  "Id": {
    "type": "string",
    "minLength": 1,
    "maxLength": 128
  },
  "Key": {
    "type": "string",
    "minLength": 8,
    "maxLength": 128,
    "pattern": "^[A-Za-z0-9._:-]+$"
  },
  "Revision": {
    "type": "integer",
    "minimum": 0,
    "maximum": 9007199254740991
  },
  "ReadContext": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "worldSessionId": {
        "$ref": "#/$defs/Id"
      }
    },
    "required": [
      "worldSessionId"
    ]
  },
  "WriteContext": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "worldSessionId": {
        "$ref": "#/$defs/Id"
      },
      "transactionId": {
        "$ref": "#/$defs/Id"
      },
      "idempotencyKey": {
        "$ref": "#/$defs/Key"
      },
      "expectedRevision": {
        "$ref": "#/$defs/Revision"
      }
    },
    "required": [
      "worldSessionId",
      "transactionId",
      "idempotencyKey",
      "expectedRevision"
    ]
  },
  "Point": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "x": {
        "type": "integer",
        "minimum": 0,
        "maximum": 4095
      },
      "y": {
        "type": "integer",
        "minimum": 0,
        "maximum": 4095
      }
    },
    "required": [
      "x",
      "y"
    ]
  },
  "Rect": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "x": {
        "type": "integer",
        "minimum": 0,
        "maximum": 4095
      },
      "y": {
        "type": "integer",
        "minimum": 0,
        "maximum": 4095
      },
      "width": {
        "type": "integer",
        "minimum": 1,
        "maximum": 4096
      },
      "height": {
        "type": "integer",
        "minimum": 1,
        "maximum": 4096
      }
    },
    "required": [
      "x",
      "y",
      "width",
      "height"
    ]
  },
  "Tile": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "tilesetId": {
        "$ref": "#/$defs/Id"
      },
      "tileId": {
        "type": "integer",
        "minimum": 0,
        "maximum": 4294967295
      },
      "flags": {
        "type": "integer",
        "minimum": 0,
        "maximum": 7,
        "default": 0
      }
    },
    "required": [
      "tilesetId",
      "tileId"
    ]
  },
  "PaintValue": {
    "oneOf": [
      {
        "type": "null"
      },
      {
        "$ref": "#/$defs/Tile"
      },
      {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "collision": {
            "type": "integer",
            "minimum": 0,
            "maximum": 2
          }
        },
        "required": [
          "collision"
        ]
      }
    ]
  },
  "CellWrite": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "x": {
        "type": "integer",
        "minimum": 0,
        "maximum": 4095
      },
      "y": {
        "type": "integer",
        "minimum": 0,
        "maximum": 4095
      },
      "value": {
        "$ref": "#/$defs/PaintValue"
      }
    },
    "required": [
      "x",
      "y",
      "value"
    ]
  },
  "LayerMapping": {
    "type": "array",
    "maxItems": 16,
    "items": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "sourceLayerId": {
          "$ref": "#/$defs/Id"
        },
        "targetLayerId": {
          "$ref": "#/$defs/Id"
        }
      },
      "required": [
        "sourceLayerId",
        "targetLayerId"
      ]
    }
  },
  "FieldValue": {
    "oneOf": [
      {
        "type": "string",
        "maxLength": 4096
      },
      {
        "type": "number",
        "minimum": -1000000000,
        "maximum": 1000000000
      },
      {
        "type": "boolean"
      },
      {
        "type": "null"
      },
      {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "x": {
            "type": "number",
            "minimum": 0,
            "maximum": 1048576
          },
          "y": {
            "type": "number",
            "minimum": 0,
            "maximum": 1048576
          }
        },
        "required": [
          "x",
          "y"
        ]
      }
    ]
  },
  "TagTarget": {
    "oneOf": [
      {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "kind": {
            "const": "tile"
          },
          "tilesetId": {
            "$ref": "#/$defs/Id"
          },
          "tileId": {
            "type": "integer",
            "minimum": 0,
            "maximum": 4294967295
          }
        },
        "required": [
          "kind",
          "tilesetId",
          "tileId"
        ]
      },
      {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "kind": {
            "const": "stamp"
          },
          "stampId": {
            "$ref": "#/$defs/Id"
          }
        },
        "required": [
          "kind",
          "stampId"
        ]
      }
    ]
  },
  "TagWords": {
    "type": "array",
    "maxItems": 16,
    "uniqueItems": true,
    "items": {
      "type": "string",
      "minLength": 1,
      "maxLength": 48
    }
  },
  "TagWriteContext": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "worldSessionId": {
        "$ref": "#/$defs/Id"
      },
      "idempotencyKey": {
        "$ref": "#/$defs/Key"
      }
    },
    "required": [
      "worldSessionId",
      "idempotencyKey"
    ]
  }
} as const;

const DEFINITIONS = [
  {
    "name": "get_session",
    "title": "Get Session",
    "description": "also polls a submitted/terminal transaction. No open world is required. No open world required. Poll transactionId for terminal approval/cancellation; transaction ownership is authenticated by the server. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT.",
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "transactionId": {
          "$ref": "#/$defs/Id"
        }
      },
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "get_map_info",
    "title": "Get Map Info",
    "description": " Loads the exact live map without changing active selection. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT.",
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/ReadContext"
        },
        "mapId": {
          "$ref": "#/$defs/Id"
        }
      },
      "required": [
        "context",
        "mapId"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "read_region",
    "title": "Read Region",
    "description": "returns row-major local refs, not palette integers. At most 4,096 cells per layer, 16,384 total across at most 8 layers; entities capped at 256. Row-major local legend references; collision values are raw 0/1/2. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT.",
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/ReadContext"
        },
        "mapId": {
          "$ref": "#/$defs/Id"
        },
        "region": {
          "$ref": "#/$defs/Rect"
        },
        "layerIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 8,
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/Id"
          }
        },
        "includeEntities": {
          "type": "boolean",
          "default": false
        }
      },
      "required": [
        "context",
        "mapId",
        "region",
        "layerIds"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "list_tilesets",
    "title": "List Tilesets",
    "description": " Page size 1–128 (default 64). Cursors are opaque and bound to world/revision/filter. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT.",
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/ReadContext"
        },
        "cursor": {
          "$ref": "#/$defs/Id"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 128,
          "default": 64
        }
      },
      "required": [
        "context"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "get_tile_catalog",
    "title": "Get Tile Catalog",
    "description": "metadata plus optional labelled contact sheet or source-sheet crop. `tileIds` and `offset/limit` are mutually exclusive by semantic validation. `sheetRegion` uses tileset grid coordinates and is valid only for `image:\"sheet\"`; omission means the whole sheet **only if it fits image limits**, otherwise return a required smaller-region diagnostic. `image:\"tiles\"` has at most 64 IDs and deterministic numeric labels outside each sprite. `image:\"none\"` permits 128. A “tile” request with one ID is the individual cropped tile image; no separate crop tool is needed. At most 128 metadata records or 64 pictured tiles. Tile IDs and offset/limit are mutually exclusive. One PNG at most 2,048 px/side, 4,194,304 pixels and 4 MiB; response at most 8 MiB. Labels use gutters; sourceRect is in source pixels. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT.",
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/ReadContext"
        },
        "tilesetId": {
          "$ref": "#/$defs/Id"
        },
        "tileIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 128,
          "uniqueItems": true,
          "items": {
            "type": "integer",
            "minimum": 0,
            "maximum": 4294967295
          }
        },
        "offset": {
          "type": "integer",
          "minimum": 0,
          "maximum": 4294967295,
          "default": 0
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 128,
          "default": 64
        },
        "image": {
          "type": "string",
          "enum": [
            "none",
            "tiles",
            "sheet"
          ],
          "default": "tiles"
        },
        "sheetRegion": {
          "$ref": "#/$defs/Rect"
        },
        "scale": {
          "type": "integer",
          "enum": [
            1,
            2,
            4
          ],
          "default": 2
        }
      },
      "required": [
        "context",
        "tilesetId"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "list_stamps",
    "title": "List Stamps",
    "description": " At most 32 records (default 16), optionally one requested preview PNG at most 2,048 px/side and 4 MiB. Library tags remain distinct from semantic tags. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT.",
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/ReadContext"
        },
        "query": {
          "type": "string",
          "maxLength": 128
        },
        "cursor": {
          "$ref": "#/$defs/Id"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 32,
          "default": 16
        },
        "previewStampId": {
          "$ref": "#/$defs/Id"
        }
      },
      "required": [
        "context"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "begin_edit",
    "title": "Begin Edit",
    "description": "acquire one request-sized group, not an auto-commit permission. One world writer; at most 8 explicit target maps, 256 mutations, 262,144 cumulative planned writes, 64 MiB retained bytes and 256 metadata participants. Begin drains admitted writes within 30 seconds. Running edit lifetime is 30 minutes. finish_edit requests human review; the agent cannot approve/save. Stopped/review inactivity never approves or discards automatically. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/ReadContext"
        },
        "idempotencyKey": {
          "$ref": "#/$defs/Key"
        },
        "expectedRevision": {
          "$ref": "#/$defs/Revision"
        },
        "requestLabel": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160
        },
        "mapIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 8,
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/Id"
          }
        }
      },
      "required": [
        "context",
        "idempotencyKey",
        "expectedRevision",
        "requestLabel",
        "mapIds"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "finish_edit",
    "title": "Finish Edit",
    "description": " Returns awaitingApproval immediately. It seals writes and retains the save/edit lock; only the user can approve or discard. Never commits, saves or waits for the user inside this call. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/WriteContext"
        },
        "summary": {
          "type": "string",
          "maxLength": 512
        }
      },
      "required": [
        "context"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "cancel_edit",
    "title": "Cancel Edit",
    "description": "owner can discard; user can always discard locally. For `cancel_edit` only, a stale expected revision does not block safe cancellation of the caller's still-owned transaction. World identity and ownership are mandatory. Finish requires the current revision. A terminal duplicate is safe under §2.5. World identity and ownership are required; a stale expectedRevision does not prevent safe cancellation of the owned edit. Rolls back all tentative map changes; independent tags survive. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/WriteContext"
        },
        "reason": {
          "type": "string",
          "maxLength": 256
        }
      },
      "required": [
        "context"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "paint_cells",
    "title": "Paint Cells",
    "description": "a single layer, one bounded batch. Duplicate coordinates are rejected. At most 4,096 writes on one layer. Duplicate coordinates reject the batch. Compact flags H=1,V=2,D=4; null erases; collision values only on collision layers. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT. Edit changes remain tentative until user approval; finish_edit only requests review.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/WriteContext"
        },
        "mapId": {
          "$ref": "#/$defs/Id"
        },
        "layerId": {
          "$ref": "#/$defs/Id"
        },
        "cells": {
          "type": "array",
          "minItems": 1,
          "maxItems": 4096,
          "items": {
            "$ref": "#/$defs/CellWrite"
          }
        }
      },
      "required": [
        "context",
        "mapId",
        "layerId",
        "cells"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "paint_rect",
    "title": "Paint Rect",
    "description": "Outline 0 fills, otherwise use existing `rectangleBandContains`; width is in cells. Count the resulting band, not merely the rectangle's area, but reject an excessively large scan without enumerating it. At most 4,096 planned cells, including outline; outline 0 fills, otherwise 1–16 cells wide. The full half-open region must fit. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT. Edit changes remain tentative until user approval; finish_edit only requests review.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/WriteContext"
        },
        "mapId": {
          "$ref": "#/$defs/Id"
        },
        "layerId": {
          "$ref": "#/$defs/Id"
        },
        "region": {
          "$ref": "#/$defs/Rect"
        },
        "value": {
          "$ref": "#/$defs/PaintValue"
        },
        "outline": {
          "type": "integer",
          "minimum": 0,
          "maximum": 16,
          "default": 0
        }
      },
      "required": [
        "context",
        "mapId",
        "layerId",
        "region",
        "value"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "paint_line",
    "title": "Paint Line",
    "description": "Reuse `geometry.ts::lineCells` (Bresenham) with a square footprint, even-width offsets `[-floor((w-1)/2), ..., ceil((w-1)/2)]`. Full expanded footprint must fit. At most 4,096 planned cells. Bresenham line with square width 1–16; even-width offsets [-floor((w-1)/2), ceil((w-1)/2)]. Full footprint must fit. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT. Edit changes remain tentative until user approval; finish_edit only requests review.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/WriteContext"
        },
        "mapId": {
          "$ref": "#/$defs/Id"
        },
        "layerId": {
          "$ref": "#/$defs/Id"
        },
        "from": {
          "$ref": "#/$defs/Point"
        },
        "to": {
          "$ref": "#/$defs/Point"
        },
        "value": {
          "$ref": "#/$defs/PaintValue"
        },
        "width": {
          "type": "integer",
          "minimum": 1,
          "maximum": 16,
          "default": 1
        }
      },
      "required": [
        "context",
        "mapId",
        "layerId",
        "from",
        "to",
        "value"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "fill",
    "title": "Fill",
    "description": "Four-neighbour fill matching the full existing cell including flags, bounded by region; reaching more than `maxCells` fails before mutation. No unrestricted whole-world fill. Explicit rectangle and maxCells 1–4,096. Four-neighbor fill matching the complete cell including flags. Exceeding the budget rejects before dispatch, with no partial fill. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT. Edit changes remain tentative until user approval; finish_edit only requests review.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/WriteContext"
        },
        "mapId": {
          "$ref": "#/$defs/Id"
        },
        "layerId": {
          "$ref": "#/$defs/Id"
        },
        "start": {
          "$ref": "#/$defs/Point"
        },
        "region": {
          "$ref": "#/$defs/Rect"
        },
        "value": {
          "$ref": "#/$defs/PaintValue"
        },
        "maxCells": {
          "type": "integer",
          "minimum": 1,
          "maximum": 4096,
          "default": 4096
        }
      },
      "required": [
        "context",
        "mapId",
        "layerId",
        "start",
        "region",
        "value"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "prepare_smart_source",
    "title": "Prepare Smart Source",
    "description": "source selection and generated assets are transaction-owned. Use `detectNineSliceSelection`, `nineSliceProblem`, `prepareNineSliceTileset` and existing bake machinery. Source/map tile widths **and heights** must agree; return `GRID_MISMATCH` with facts, never rescale or silently resize. `force:true` is the existing explicit single-object override with geometric b=1; it does not claim pixel evidence. No source is inferred from the word “river.” Return a transaction/map-bound opaque `sourceId`, band width, detector version, source fingerprint, ready usages (`area`, optionally `road`) and generated atlas IDs. Reject non-road stamps for path tools with an actionable reason. The agent can read the catalog and select another source. Source rectangle at most 32×32 tiles; native tile widths and heights must match. No rescaling. Preparation timeout 30 seconds; staged image/bake bytes count toward 64 MiB. Opaque sourceId is transaction/map bound and invalidated on source changes. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT. Edit changes remain tentative until user approval; finish_edit only requests review.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/WriteContext"
        },
        "mapId": {
          "$ref": "#/$defs/Id"
        },
        "source": {
          "oneOf": [
            {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "stampId": {
                  "$ref": "#/$defs/Id"
                }
              },
              "required": [
                "stampId"
              ]
            },
            {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "tilesetId": {
                  "$ref": "#/$defs/Id"
                },
                "region": {
                  "$ref": "#/$defs/Rect"
                }
              },
              "required": [
                "tilesetId",
                "region"
              ]
            }
          ]
        },
        "force": {
          "type": "boolean",
          "default": false
        }
      },
      "required": [
        "context",
        "mapId",
        "source"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "smart_brush",
    "title": "Smart Brush",
    "description": "one primitive for area and road memberships. `area` requires only `region`, `erase:false`; `road` requires only distinct `cells`, interpreted as macro-cell top-lefts aligned to `(0,0)` for band b. Explicit target layer; multilayer smart sources require a separate prepared per-layer mapping in the preparation result, validated before apply. If no unambiguous mapping exists return `STAMP_MAPPING_REQUIRED` and require the user/agent to create matching layers, rather than guessing. Use the existing planners and include all changed neighbors in limits/summary. D4 quarter-turns require square map cells. At most 4,096 planned writes across destination layers including neighbor repairs. Area requires only region and erase:false; road requires only distinct macro-cell top-left cells aligned to band b. D4 quarter-turns require square map cells. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT. Edit changes remain tentative until user approval; finish_edit only requests review.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/WriteContext"
        },
        "mapId": {
          "$ref": "#/$defs/Id"
        },
        "layerId": {
          "$ref": "#/$defs/Id"
        },
        "sourceId": {
          "$ref": "#/$defs/Id"
        },
        "mode": {
          "type": "string",
          "enum": [
            "area",
            "road"
          ]
        },
        "region": {
          "$ref": "#/$defs/Rect"
        },
        "cells": {
          "type": "array",
          "minItems": 1,
          "maxItems": 4096,
          "items": {
            "$ref": "#/$defs/Point"
          }
        },
        "orientation": {
          "type": "integer",
          "minimum": 0,
          "maximum": 7,
          "default": 0
        },
        "erase": {
          "type": "boolean",
          "default": false
        }
      },
      "required": [
        "context",
        "mapId",
        "layerId",
        "sourceId",
        "mode"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "draw_path",
    "title": "Draw Path",
    "description": "river/path convenience over the same smart-road planner. Points are map cells; convert to the b-grid by floor division, bridge adjacent samples with `orthogonalBridge`, expand the same documented square footprint in macro units, union, then `planSmartStampRoad`/`applySmartStampPlan`. Return snapped centerline, actual tile width `width*b`, affected bounds and repairs. `kind` changes descriptive intent/logging only; the caller chooses a suitable source. No hydrology, splines, hidden randomness or added terrain system. Bridge structures are separate stamp placements. 2–128 map-cell points, width 1–16 macro cells. Snaps by floor(cell/b), bridges orthogonally, uses a square footprint; actual tile width is width*b. At most 4,096 total writes including repairs. kind records intent; it never selects art. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT. Edit changes remain tentative until user approval; finish_edit only requests review.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/WriteContext"
        },
        "mapId": {
          "$ref": "#/$defs/Id"
        },
        "layerId": {
          "$ref": "#/$defs/Id"
        },
        "sourceId": {
          "$ref": "#/$defs/Id"
        },
        "kind": {
          "type": "string",
          "enum": [
            "path",
            "river"
          ]
        },
        "points": {
          "type": "array",
          "minItems": 2,
          "maxItems": 128,
          "items": {
            "$ref": "#/$defs/Point"
          }
        },
        "width": {
          "type": "integer",
          "minimum": 1,
          "maximum": 16,
          "default": 1
        },
        "orientation": {
          "type": "integer",
          "minimum": 0,
          "maximum": 7,
          "default": 0
        }
      },
      "required": [
        "context",
        "mapId",
        "layerId",
        "sourceId",
        "kind",
        "points"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "place_stamp",
    "title": "Place Stamp",
    "description": "Transform by rotation, then mirrors, with transformed top-left at `at`, matching core. Preflight all transformed bounds, used references and destinations. Without a mapping use `stampLayerMapping`; ambiguities are errors and missing layers require `allowCreateLayers:true`. With an explicit mapping use transformed clip + `pasteClip`; require every nonempty source layer exactly once and compatible target kinds/roles. No partial placement on hidden/locked layers. Preseed all required palette refs reversibly. At most 4,096 planned writes across all destination layers; layer mapping at most 16 entries. Rotation precedes mirrors; transformed top-left is at. No partial placement or implicit writes to protected layers. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT. Edit changes remain tentative until user approval; finish_edit only requests review.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/WriteContext"
        },
        "mapId": {
          "$ref": "#/$defs/Id"
        },
        "stampId": {
          "$ref": "#/$defs/Id"
        },
        "at": {
          "$ref": "#/$defs/Point"
        },
        "rotation": {
          "type": "integer",
          "minimum": 0,
          "maximum": 3,
          "default": 0
        },
        "flipX": {
          "type": "boolean",
          "default": false
        },
        "flipY": {
          "type": "boolean",
          "default": false
        },
        "layerMapping": {
          "$ref": "#/$defs/LayerMapping"
        },
        "allowCreateLayers": {
          "type": "boolean",
          "default": false
        },
        "emptyCells": {
          "type": "string",
          "enum": [
            "skip",
            "erase"
          ],
          "default": "skip"
        }
      },
      "required": [
        "context",
        "mapId",
        "stampId",
        "at"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "edit_layer",
    "title": "Edit Layer",
    "description": "create/rename/visibility/lock/order; no delete/merge in v2 tools. Layer indices are zero-based bottom-to-top. Locks/hidden flags present at begin are protected for content writes throughout the action: the agent cannot unlock/show and then paint an initially protected layer. Metadata changes to a locked layer are limited to explicit visibility/lock updates; rename/reorder/opacity while locked fail. A newly locked/hidden layer also rejects subsequent content writes. Return the protected layer IDs in begin results. This preserves the user's locks without removing the requested metadata management tools. At most 128 layers/map and 128 characters/name. Indices are zero-based bottom-to-top. Begin-baseline locked/hidden content stays protected even if shown/unlocked. No layer deletion/merge. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT. Edit changes remain tentative until user approval; finish_edit only requests review.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "context": {
              "$ref": "#/$defs/WriteContext"
            },
            "mapId": {
              "$ref": "#/$defs/Id"
            },
            "action": {
              "const": "create"
            },
            "name": {
              "type": "string",
              "minLength": 1,
              "maxLength": 128
            },
            "kind": {
              "type": "string",
              "enum": [
                "tile",
                "collision",
                "entity"
              ]
            },
            "index": {
              "type": "integer",
              "minimum": 0,
              "maximum": 128
            }
          },
          "required": [
            "context",
            "mapId",
            "action",
            "name",
            "kind"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "context": {
              "$ref": "#/$defs/WriteContext"
            },
            "mapId": {
              "$ref": "#/$defs/Id"
            },
            "action": {
              "const": "update"
            },
            "layerId": {
              "$ref": "#/$defs/Id"
            },
            "props": {
              "type": "object",
              "additionalProperties": false,
              "minProperties": 1,
              "properties": {
                "name": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 128
                },
                "visible": {
                  "type": "boolean"
                },
                "locked": {
                  "type": "boolean"
                },
                "opacity": {
                  "type": "number",
                  "minimum": 0,
                  "maximum": 1
                }
              }
            }
          },
          "required": [
            "context",
            "mapId",
            "action",
            "layerId",
            "props"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "context": {
              "$ref": "#/$defs/WriteContext"
            },
            "mapId": {
              "$ref": "#/$defs/Id"
            },
            "action": {
              "const": "reorder"
            },
            "layerId": {
              "$ref": "#/$defs/Id"
            },
            "index": {
              "type": "integer",
              "minimum": 0,
              "maximum": 127
            }
          },
          "required": [
            "context",
            "mapId",
            "action",
            "layerId",
            "index"
          ]
        }
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "list_entity_types",
    "title": "List Entity Types",
    "description": "Include built-in `spawn` and `portal`, field types/defaults and enum choices. No tool invents types or fields. Includes existing built-in spawn/portal types and defaults/enums. No entity-type mutation tool exists. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT.",
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/ReadContext"
        }
      },
      "required": [
        "context"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "place_entity",
    "title": "Place Entity",
    "description": "`at` is a cell; convert to native map pixel coordinates for `addEntity`. ID is server allocated/idempotent. Reuse `entityFieldValueProblem`, `defaultEntityFields`, `entityProblem`; reject reserved/prototype field names, unknown fields, invalid enums and nonexistent `levelRef`/portal targets. Point field values are pixels in their field's target map, not cells. Return exact stored pixel position and resolved fields. at uses map cells; stored position and point fields use native pixels. At most 64 fields; string values at most 4,096 characters. Server allocates the ID. Unknown/reserved fields and invalid enum/portal refs reject. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT. Edit changes remain tentative until user approval; finish_edit only requests review.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/WriteContext"
        },
        "mapId": {
          "$ref": "#/$defs/Id"
        },
        "layerId": {
          "$ref": "#/$defs/Id"
        },
        "typeId": {
          "$ref": "#/$defs/Id"
        },
        "at": {
          "$ref": "#/$defs/Point"
        },
        "fields": {
          "type": "object",
          "maxProperties": 64,
          "propertyNames": {
            "type": "string",
            "minLength": 1,
            "maxLength": 128
          },
          "additionalProperties": {
            "$ref": "#/$defs/FieldValue"
          }
        }
      },
      "required": [
        "context",
        "mapId",
        "layerId",
        "typeId",
        "at"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "create_map",
    "title": "Create Map",
    "description": "Validate tile dimensions against existing `document.ts` constraints too; effective max is the stricter bound. `world` is world pixels; default placement uses workspace `#freeWorldSpot`. Defaults/layer template come from world settings; an empty template creates one tile layer. New map automatically joins the current transaction's target set and returns ID/path/layers. No new world or arbitrary output path is accepted. Only valid inside an edit. Cancellation removes the provisional map. After approval undo reverts contents but retains map-list membership. Only inside an edit. Dimensions 1–4,096, area at most 1,048,576, tile dimensions bounded by both schema and core. world is world pixels; path/ID are host allocated. Cancellation removes the provisional map. Approval retains membership through undo; only contents undo. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT. Edit changes remain tentative until user approval; finish_edit only requests review.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/WriteContext"
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "width": {
          "type": "integer",
          "minimum": 1,
          "maximum": 4096
        },
        "height": {
          "type": "integer",
          "minimum": 1,
          "maximum": 4096
        },
        "tileWidth": {
          "type": "integer",
          "minimum": 1,
          "maximum": 512
        },
        "tileHeight": {
          "type": "integer",
          "minimum": 1,
          "maximum": 512
        },
        "world": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "x": {
              "type": "integer",
              "minimum": -1000000000,
              "maximum": 1000000000
            },
            "y": {
              "type": "integer",
              "minimum": -1000000000,
              "maximum": 1000000000
            }
          },
          "required": [
            "x",
            "y"
          ]
        }
      },
      "required": [
        "context",
        "name",
        "width",
        "height",
        "tileWidth",
        "tileHeight"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "resize_map",
    "title": "Resize Map",
    "description": "Top-left anchored, native grid unchanged. If occupied cells/entities would be removed, default returns `CROP_REQUIRES_EXPLICIT_ALLOW` with counts/bounds; `allowCrop:true` permits undoable crop after memory and protected-layer checks. Existing `resizeMap` op owns bounds/entity behavior. Do not silently crop initially locked/hidden layers even with allowCrop. Dimensions 1–4,096, area at most 1,048,576, retained resize chunks charged to 64 MiB. Top-left anchored; native grid unchanged. Crop requires allowCrop:true; protected content remains protected. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT. Edit changes remain tentative until user approval; finish_edit only requests review.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/WriteContext"
        },
        "mapId": {
          "$ref": "#/$defs/Id"
        },
        "width": {
          "type": "integer",
          "minimum": 1,
          "maximum": 4096
        },
        "height": {
          "type": "integer",
          "minimum": 1,
          "maximum": 4096
        },
        "allowCrop": {
          "type": "boolean",
          "default": false
        }
      },
      "required": [
        "context",
        "mapId",
        "width",
        "height"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "render_preview",
    "title": "Render Preview",
    "description": "No region means whole map fitted to maxSide; explicit regions preserve native or integer nearest enlargement when it fits. The result discloses scaling and exact pixel-to-cell transform. Hidden layers remain hidden unless changed through an explicit metadata operation. Optional entity markers are editor overlays, not imaginary sprites. Collision remains a data/validation concern unless its layer was expressly requested, then render its documented overlay. At most one PNG, 2,048 px/side, 4,194,304 pixels, 4 MiB compressed, 8 MiB response; timeout 30 seconds. Whole map fits maxSide; explicit regions preserve native or integer nearest enlargement when possible. Transform includes ruler gutters. This creates no disk export. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT.",
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/ReadContext"
        },
        "mapId": {
          "$ref": "#/$defs/Id"
        },
        "region": {
          "$ref": "#/$defs/Rect"
        },
        "layerIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 32,
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/Id"
          }
        },
        "maxSide": {
          "type": "integer",
          "minimum": 256,
          "maximum": 2048,
          "default": 1536
        },
        "grid": {
          "type": "boolean",
          "default": false
        },
        "coordinates": {
          "type": "boolean",
          "default": false
        },
        "entities": {
          "type": "boolean",
          "default": true
        }
      },
      "required": [
        "context",
        "mapId"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "validate_map",
    "title": "Validate Map",
    "description": "Validate bounds, layer kinds/protection violations recorded by the transaction audit, palette/tileset/tile/stamp refs, entity schemas/portal targets and generated-source availability. A locked layer containing old data is **not** itself invalid. Page/chunk the scan with deadlines and revision-bound cursor; whole-map validation is read-only, not a 4,096-cell paint. Report structural validity, not inferred aesthetics, walkability or “houses avoid water” guarantees. Revision-bound paginated structural scan, at most 256 issues/page (default 128). Whole-map validation is read-only and is not restricted to the 4,096-cell paint limit. No aesthetic/walkability inference. Coordinates are zero-based cells, y down, and rectangles half-open unless explicitly pixels/world units. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT.",
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/ReadContext"
        },
        "mapId": {
          "$ref": "#/$defs/Id"
        },
        "region": {
          "$ref": "#/$defs/Rect"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 256,
          "default": 128
        },
        "cursor": {
          "$ref": "#/$defs/Id"
        }
      },
      "required": [
        "context",
        "mapId"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "get_tags",
    "title": "Get Tags",
    "description": "discovery, including tiles/stamps needing annotation. Returns current fingerprints and safe catalog targets; agent obtains images through catalog/stamp tools before proposing words. Requires worldSessionId only; available during and outside an edit. At most 128 records/page. Requires only worldSessionId. Available during and outside edits; stale/orphan annotations remain visible. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT.",
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/ReadContext"
        },
        "kind": {
          "type": "string",
          "enum": [
            "tiles",
            "stamps"
          ],
          "default": "tiles"
        },
        "tilesetId": {
          "$ref": "#/$defs/Id"
        },
        "status": {
          "type": "string",
          "enum": [
            "all",
            "missing",
            "stale"
          ],
          "default": "missing"
        },
        "cursor": {
          "$ref": "#/$defs/Id"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 128,
          "default": 64
        }
      },
      "required": [
        "context"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "set_tags",
    "title": "Set Tags",
    "description": "Replace tags per target; [] clears. Requires worldSessionId and idempotencyKey, never transactionId or expectedRevision. Tags persist independently, immediately (debounced at most 500 ms), outside edit approval and undo. Fingerprint mismatch or duplicate targets rejects the entire batch. Requires worldSessionId and idempotencyKey, no transactionId/expectedRevision. Batch at most 128 targets; each at most 16 distinct tags of 1–48 characters and note at most 256. [] clears. Fingerprints are 64 lowercase SHA-256 hex digits. All-or-nothing validation. Persists independently within 500 ms; outside map approval and undo. Results disclose API revision and tentative state; refresh revision after REVISION_CONFLICT.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": true,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/TagWriteContext"
        },
        "entries": {
          "type": "array",
          "minItems": 1,
          "maxItems": 128,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "target": {
                "$ref": "#/$defs/TagTarget"
              },
              "expectedFingerprint": {
                "type": "string",
                "pattern": "^[a-f0-9]{64}$"
              },
              "tags": {
                "$ref": "#/$defs/TagWords"
              },
              "note": {
                "type": "string",
                "maxLength": 256,
                "default": ""
              }
            },
            "required": [
              "target",
              "expectedFingerprint",
              "tags"
            ]
          }
        }
      },
      "required": [
        "context",
        "entries"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  }
] as const;

export const TOOL_DEFINITIONS: readonly AgentToolDefinition[] = DEFINITIONS.map(tool => ({
  ...tool, inputSchema: { ...tool.inputSchema, $defs: SHARED_DEFS },
}));

/** Code-unit key order, LF, two spaces and one final newline, independent of host locale. */
export function canonicalJson(value: unknown): string {
  function sorted(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(item => sorted(item));
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(Object.keys(input).sort().map(key => [key, sorted((input as { readonly [key: string]: unknown })[key]!)]));
    }
    return input;
  }
  return JSON.stringify(sorted(value), null, 2) + "\n";
}

/** The root is an MCP tools/list result, directly embeddable by Rust. */
export function generateToolsJson(): string {
  return canonicalJson({ tools: TOOL_DEFINITIONS });
}
