/** Frozen v2 catalogue. Each published input schema contains its reachable local definitions. */
import type { AgentToolDefinition, JsonValue } from "./contracts.ts";

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
    "description": "Optional. Omit to use the open world; pass worldSessionId from get_session only to reject a replaced world.",
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "worldSessionId": {
        "$ref": "#/$defs/Id"
      }
    },
    "required": []
  },
  "WriteContext": {
    "description": "Optional; omit it entirely in an ordinary edit. Omitted fields use the open world and your own active edit, calls apply in arrival order without revision checks and are not replay-cached. Supply idempotencyKey to make a retry safe (same payload/key replays), expectedRevision for strict whole-world CAS. Collaborative drafts need expectedRevision or expectedMemberRevision (never both).",
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
      },
      "expectedMemberRevision": {
        "$ref": "#/$defs/Revision"
      }
    },
    "required": [],
    "not": {
      "required": [
        "expectedRevision",
        "expectedMemberRevision"
      ],
      "properties": {
        "expectedRevision": {},
        "expectedMemberRevision": {}
      }
    }
  },
  "Point": {
    "description": "Zero-based map-cell coordinate, x right and y down unless the tool explicitly states world pixels.",
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
    "description": "Half-open rectangle: x <= cellX < x+width, y <= cellY < y+height; map cells unless explicitly a tileset sheet region.",
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
    "description": "Stable tilesetId/tileId from catalog, with optional compact D4 flags H=1,V=2,D=4; not a palette integer.",
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
  "ResumeToken": {
    "type": "string",
    "minLength": 32,
    "maxLength": 128,
    "pattern": "^[A-Za-z0-9_-]+$"
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
    "required": []
  }
} as const;

const DEFINITIONS = [
  {
    "name": "get_session",
    "title": "Get Session",
    "description": "Start here. Inspect the open world, active map/layer, maps, revision, clients and transaction. No arguments or open world required. Use returned worldSessionId in every subsequent context. Workflow: get_session → inspect catalogs/maps → begin_edit → paint/place/preview/validate → finish_edit → wait for human Onayla or Vazgeç. Poll transactionId to learn the final approval/cancellation outcome. Never approve or save yourself. smart lists detected smart art [{tilesetId,rect,kind,band}] for draw_path/smart_brush source {tilesetId,region:rect}.",
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
    "description": "Inspect one map and its layers without changing the user’s selected map. Obtain stable mapId from get_session and layerId/kind/visibility/locks here before painting. context is optional. Dimensions are cells; tileWidth/tileHeight are native pixels.",
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
    "description": "Read map cells. region (half-open {x,y,width,height}, zero-based cells, y down) defaults to the whole map; layerIds defaults to every visible tile and collision layer. Default format \"grid\" returns per layer {layerId,name,kind,rows,legend}: one character per cell, legend char → {tilesetId,tileId,flags?} or {collision:n}, \".\" = empty (null). Same shape paint_grid accepts, so you can edit rows and paint them back (origin = region x,y). Entirely empty layers are listed in emptyLayerIds instead. format \"cells\" returns the older flat legend-index arrays. Maximum 16384 cells/layer, 65536 total, 16 layers, 256 entities.",
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
          "maxItems": 16,
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/Id"
          }
        },
        "includeEntities": {
          "type": "boolean",
          "default": false
        },
        "format": {
          "type": "string",
          "enum": [
            "grid",
            "cells"
          ],
          "default": "grid"
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
    "name": "list_tilesets",
    "title": "List Tilesets",
    "description": "Discover tileset IDs, names, native tile sizes and sheet grid dimensions before choosing art. Use includeDetails:false for initial discovery without hashing source pixels; fingerprint/tagCounts are omitted. Default includeDetails:true computes those details and can be expensive for large cold atlases. context is optional. Page limit 1–128 (default 64); reuse nextCursor unchanged with the same filters/world revision. Then call get_tile_catalog with images to inspect the actual art. Each source tileset lists smart:[{tilesetId,rect,kind,band}] detected edge/centre blocks; pass {tilesetId,region:rect} as smart_brush/draw_path source (kind road = paths/rivers and areas).",
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
        "includeDetails": {
          "type": "boolean",
          "default": true
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
    "description": "Sheet mode is a continuous atlas crop with compact sheet grid/source metadata and no per-tile placements. sheetRegion determines the row-major metadata page; offset/nextOffset are relative to that region. Sheet mode cannot combine tileIds. Inspect real tile art and stable numeric tile IDs before choosing tiles. context is optional. image:\"tiles\" returns a labelled contact sheet (≤64 tiles); image:\"sheet\" returns a labelled sheetRegion in tileset grid cells; image:\"none\" returns metadata only (≤128). Choose either tileIds or offset/limit. scale is 1,2,4. One ID gives a cropped tile. sourceRect is native source pixels; labels occupy separate gutters. PNG ≤2048 px/side and 4 MiB. Select a smaller page/region when too large. Tile meanings are not inferred from IDs.",
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
    "description": "Discover reusable multilayer stamps, source-layer IDs, native size, smart usages and semantic tags. context is optional. Search normalized names, categories, library tags and current semantic labels with query; paginate ≤32 records (default 16); previewStampId adds one real PNG. Use place_stamp for flat objects, or prepare_smart_source only for suitable smart art.",
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
    "description": "Begin one tentative draft. requestLabel describes the user’s request, mapIds names 1–8 explicit targets; context, expectedRevision (CAS) and idempotencyKey are optional. Later writes may omit context: they use this draft. unlockLayerIds unlocks/shows those layers inside the draft so you can paint them. Returns resumeToken: keep it secret; after a disconnect, restart or finish_edit call resume_edit({transactionId,resumeToken}) to continue the same draft. One world writer, ≤4096 mutation calls, 1048576 planned cell writes per draft. Inactivity lease 30 minutes, extended by every call; on lease end or disconnect the draft is sealed for human review, never rolled back. finish_edit requests review; only the user approves.",
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
        },
        "unlockLayerIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 128,
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/Id"
          }
        }
      },
      "required": [
        "requestLabel",
        "mapIds"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "finish_edit",
    "title": "Finish Edit",
    "description": "Finish the drawing and request human review; returns awaitingApproval immediately. context is optional. Optional summary describes changes. Writes are sealed and locks remain; resume_edit with your resumeToken reopens the draft if you must amend it. Only the user can Onayla (one undo row) or Vazgeç (rollback). Poll get_session(transactionId); never attempt to approve/save via a tool.",
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
    "description": "Discard your owned tentative edit and restore its original maps, palettes and project metadata. context is optional; cancellation accepts a stale expectedRevision. After a disconnect pass resumeToken (with context.transactionId) to discard your orphaned or submitted draft. Provisional maps disappear. Independently written semantic tags survive. User may also discard locally.",
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
        },
        "resumeToken": {
          "$ref": "#/$defs/ResumeToken"
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
    "description": "Write sparse explicit cells on a tile or collision layer. Either cells:[{x,y,value}] (≤4096/call) or points:[[x,y],...] with one shared value (≤16384/call; cheapest for scattering one tile). For whole areas with varied tiles prefer paint_grid. Zero-based map cells, x right/y down. value is {tilesetId,tileId,flags?}, null to erase, or {collision:0|1|2} for collision layers only. flags are compact D4 H=1,V=2,D=4. All coordinates must fit; locked/hidden layers reject. Requires begin_edit; context is optional (add idempotencyKey to make retries safe). Changes remain tentative until human approval.",
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
        },
        "points": {
          "type": "array",
          "minItems": 1,
          "maxItems": 16384,
          "items": {
            "type": "array",
            "minItems": 2,
            "maxItems": 2,
            "items": {
              "type": "integer",
              "minimum": 0,
              "maximum": 4095
            }
          }
        },
        "value": {
          "$ref": "#/$defs/PaintValue"
        }
      },
      "required": [
        "context",
        "mapId",
        "layerId"
      ],
      "oneOf": [
        {
          "required": [
            "cells"
          ],
          "properties": {
            "cells": {}
          },
          "not": {
            "anyOf": [
              {
                "required": [
                  "points"
                ],
                "properties": {
                  "points": {}
                }
              },
              {
                "required": [
                  "value"
                ],
                "properties": {
                  "value": {}
                }
              }
            ]
          }
        },
        {
          "required": [
            "points",
            "value"
          ],
          "properties": {
            "points": {},
            "value": {}
          },
          "not": {
            "required": [
              "cells"
            ],
            "properties": {
              "cells": {}
            }
          }
        }
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "paint_rect",
    "title": "Paint Rect",
    "description": "Fill a half-open map-cell region {x,y,width,height} on explicit mapId/layerId with one value; optional outline 1–16 cells, default 0 fills. value is a tile reference, null (erase), collision value on a collision layer, or {random:[{tilesetId,tileId,flags?,weight?}],seed?} (deterministic per cell by hash(seed,x,y); seed defaults to the map seed). Uniform: any size up to the whole map in one call (only the edit's total cell budget applies); full region must fit, protected layers reject. Requires begin_edit; context is optional. Finish with finish_edit for human review.",
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
    "description": "Draw a straight Bresenham line from/to in zero-based map cells, y down. Square width 1–16; even widths extend one extra cell toward positive coordinates. Entire footprint must fit; ≤4096 cells including width. value is tile/null or collision on matching layer. Requires begin_edit; context is optional. For smart connected art use draw_path instead.",
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
    "description": "Four-neighbor flood fill from start (map cells) inside region (half-open; defaults to the whole map). Matches the full original value including orientation. Optional maxCells guard rejects before any mutation when exceeded; otherwise only the edit's total cell budget applies. Explicit mapId/layerId and compatible value required; value may be {random:[...],seed?} like paint_rect. Requires begin_edit; context is optional.",
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
          "maximum": 1048576
        }
      },
      "required": [
        "context",
        "mapId",
        "layerId",
        "start",
        "value"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "prepare_smart_source",
    "title": "Prepare Smart Source",
    "description": "Optional: smart_brush/draw_path accept source directly. Prepares suitable art inside the current edit and returns an opaque sourceId bound to this transaction/map, band b and usages (area, optionally road); repeating the same source in the same edit returns the same sourceId. source is {stampId} or {tilesetId,region} with region in tileset grid cells (≤32×32); get_session.smart lists detected candidates. Native tile width AND height must match map; no rescaling. Non-smart art fails; force:true overrides detection with band 1 and does not prove the art is suitable. Generated atlases are transaction-owned. ≤30 seconds, 64 MiB. Requires begin_edit; context is optional.",
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
    "description": "Paint connected edge/centre art on an explicit tile layerId. Give source {tilesetId,region} (a smart candidate from get_session/list_tilesets) or {stampId}; it is prepared once per edit and reused. A sourceId from prepare_smart_source also works. mode:\"area\" fills region (map cells) with borders; overlapping or touching areas of the same source merge into one shape with correct inner corners, so build lakes/rivers from several rectangles. mode:\"road\" takes distinct cells at macro-cell top-lefts aligned to band b (any cell set works as a free-form mask), optionally erase:true. openEdges (default true) leaves shapes touching the map border open so they continue off-map; false draws a closing border there. Neighbour repairs count toward ≤4096 planned writes. Orientation 0–7 uses D4 bits; quarter turns require square cells. Multilayer source mapping must be unambiguous. Requires begin_edit; context is optional.",
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
    "description": "Draw a road, path or river with smart art: the right tool for any connected road/river shape. source {tilesetId,region}|{stampId} (road-capable, prepared once per edit and reused) or sourceId. points: 2–128 map cells (x right, y down); consecutive points join by straight orthogonal runs, so give each bend as a point, e.g. [{x:0,y:5},{x:12,y:5},{x:12,y:31}]. Diagonal steps become staircases. width 1–16 macro cells (tiles = width*b; 3 suits a river) centred on the points. Bends, T-junctions, crossings and joins with earlier paths of the same source get matching corners. With openEdges (default true) a path reaching the map border runs off-map uncapped; parts of a wide path beyond the border are clipped. Points snap by floor(cell/b). ≤4096 writes including neighbour repairs. kind records intent only; place bridges with place_stamp. Preview before finish_edit.",
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
    "description": "Place an existing stamp by ID with transformed top-left at at (map cells). rotation 0–3 quarter turns occurs before flipX/flipY. Uses compatible source/destination layers; supply layerMapping [{sourceLayerId,targetLayerId}] when ambiguous, or allowCreateLayers:true for missing layers. emptyCells:\"skip\" (default) preserves destination under holes; \"erase\" clears them. ≤4096 writes across layers; complete transformed bounds must fit. Protected layers reject atomically. Requires begin_edit; context is optional.",
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
    "description": "Create a layer (name,kind tile|collision|entity,index?), update explicit layerId props (name,visible,locked,opacity), or reorder to zero-based bottom-to-top index. ≤128 layers/map and 128 chars/name; no delete/merge. Content protected by locks/hidden flags at begin remains protected even after unlock/show. Requires begin_edit and write context with latest revision. Obtain returned layer.id before painting.",
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
    "description": "Inspect available built-in spawn/portal and user entity schemas, field names/types/defaults/enums. context is optional. Use an existing typeId with place_entity. Tools cannot invent entity types or fields.",
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
    "description": "Place an existing typeId on an explicit entity layer. at is in zero-based map cells, converted to native map pixels. Entity point field values are native PIXELS in their target map, not cells. Omitted fields use schema defaults. Unknown/reserved fields, invalid enums and nonexistent portal targets reject. ID is allocated idempotently. ≤64 fields, strings ≤4096 chars. Requires begin_edit and write context with latest revision.",
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
    "description": "Create a provisional map INSIDE an edit, then paint using returned map.id and layer IDs. width/height are cells (1–4096, area ≤1048576); tileWidth/tileHeight are native pixels. world is optional position in world pixels. Default layers follow world settings/localized defaults. Host chooses ID/path; no arbitrary path/new world. New map joins the edit (≤8 targets). Discard/disconnect removes it; approval retains membership, and undo reverts contents while keeping the map. Requires write context {worldSessionId,transactionId,idempotencyKey,expectedRevision}.",
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
    "description": "Resize an explicit map from its top-left, preserving native tile dimensions. width/height are cells (1–4096, area ≤1048576). Occupied content outside new bounds requires allowCrop:true; initially protected content cannot be silently cropped. Result is tentative/undoable. Requires begin_edit; context is optional.",
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
    "description": "Inspect a real PNG of the current live/tentative map before finish_edit. context is optional; mapId required. Optional region is half-open map cells; otherwise whole map. maxSide (≤2048) fits large maps with nearest-neighbor scaling. grid:true and coordinates:true add cell grid and readable coordinate gutters; response image metadata gives contentRect, scale, pixelOrigin and cellSize for exact mapping. Hidden layers stay hidden. Collision overlay only for expressly requested collision layerIds. Optional entity markers are diagnostics. ≤1 PNG, 4 MiB, 30 seconds; no file export or save. Review both overview and close crop.",
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
    "description": "Read-only structural validation of explicit mapId, optional half-open map-cell region. context is optional. Reports invalid references/bounds/entity fields/portals/generated sources; existing protected content is not an error. No aesthetic, walkability or semantic guarantees. Each page scans at most 4096 records and returns ≤256 issues (default 128). Follow every revision-bound nextCursor with unchanged arguments/world until nextCursor:null; valid:null means incomplete, and only final valid:true proves integrity. Whole-map scan is not subject to paint’s 4096-cell limit. Use before finish_edit.",
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
    "description": "Discover semantic labels and tiles/stamps needing annotation. context is optional, with no transaction required; allowed during edits. kind tiles|stamps; optional tilesetId; optional query searches Turkish/English normalized labels and notes with small explicit aliases; status all|current|missing|stale (default current with query, otherwise missing), limit ≤128 and opaque cursor. Returns current fingerprints and retained stale/orphan records. Inspect actual art with get_tile_catalog/list_stamps before proposing labels. Tags do not define terrain/collision.",
    "annotations": {
      "readOnlyHint": true,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "query": {"type": "string", "maxLength": 128},
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
            "current",
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
    "description": "Replace independent semantic tags for existing targets; [] clears. context is optional {worldSessionId?,idempotencyKey?} ONLY (no transactionId or expectedRevision). entries contain target, expectedFingerprint from get_tags, tags and optional note. ≤128 targets/batch, ≤16 tags of 1–48 chars, note ≤256. Fingerprint mismatch/duplicate targets rejects the batch. Written independently within 500ms, even while map edit pending; neither discard nor undo removes tags. Never changes PNGs/terrain/collision.",
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
  },
  {
    "name": "visual_ingest_reference",
    "title": "Ingest Visual Reference",
    "description": "Retain an explicitly supplied PNG reference for this client and world session. pngBase64 is raw base64 PNG, never a path or URL. Chat attachments are not automatically accessible. Request limit 1 MiB; decoded image at most 2048 per side and 4M pixels, total retained images at most 64 MiB and 32 handles. Returns a temporary referenceId for visual_match_reference. No project or source image changes.",
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
        "pngBase64": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000000
        }
      },
      "required": [
        "context",
        "pngBase64"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "visual_match_reference",
    "title": "Match Visual Reference",
    "description": "Find exact RGBA matches of a retained reference in tile-aligned tileset regions. Tries D4 orientations and integer nearest-neighbor reference scales up to maxScale (default 4, maximum 8). Returns bounded candidates with source region, flags and scale; matched, ambiguous or no_match are exact results, not semantic confidence. Cropped screenshots with backgrounds, fractional scaling or compression are not supported. All source pixels remain unchanged. Workload limits fail explicitly instead of returning false no_match.",
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
        "referenceId": {
          "$ref": "#/$defs/Id"
        },
        "tilesetIds": {
          "type": "array",
          "minItems": 1,
          "maxItems": 32,
          "uniqueItems": true,
          "items": {
            "$ref": "#/$defs/Id"
          }
        },
        "topK": {
          "type": "integer",
          "minimum": 1,
          "maximum": 32,
          "default": 8
        },
        "maxScale": {
          "type": "integer",
          "minimum": 1,
          "maximum": 8,
          "default": 4
        }
      },
      "required": [
        "context",
        "referenceId"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  },
  {
    "name": "create_stamp",
    "title": "Create Stamp",
    "description": "Capture a reusable stamp from explicit map region/layerIds or a tileset region. Requires begin_edit and current WriteContext; it is provisional until the user approves, discard restores the stamp library, and approval joins the world undo group. Source PNGs are never modified. Region is in source cells. Name is required, category and tags are optional. Map source must belong to this transaction. Entity layers are not supported.",
    "annotations": {
      "readOnlyHint": false,
      "destructiveHint": false,
      "openWorldHint": false
    },
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "context": {
          "$ref": "#/$defs/WriteContext"
        },
        "source": {
          "oneOf": [
            {
              "type": "object",
              "additionalProperties": false,
              "properties": {
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
                }
              },
              "required": [
                "mapId",
                "region",
                "layerIds"
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
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128
        },
        "category": {
          "type": "string",
          "maxLength": 64
        },
        "tags": {
          "$ref": "#/$defs/TagWords"
        }
      },
      "required": [
        "context",
        "source",
        "name"
      ],
      "$schema": "https://json-schema.org/draft/2020-12/schema"
    }
  }
] as const;

/** Keep each schema self-contained without repeating definitions it cannot reach. */
export function reachableSchemaDefinitions<T>(schema: unknown, definitions: Readonly<Record<string, T>>): Record<string, T> {
  const reachable = new Set<string>();
  function visit(value: unknown): void {
    if (value === null || typeof value !== "object") return;
    if ("$ref" in value && typeof value.$ref === "string" && value.$ref.startsWith("#/$defs/")) {
      const name = value.$ref.slice("#/$defs/".length).split("/")[0]!.replace(/~1/g, "/").replace(/~0/g, "~");
      if (!Object.hasOwn(definitions, name)) throw new Error(`Unknown schema definition: ${name}`);
      if (!reachable.has(name)) {
        reachable.add(name);
        visit(definitions[name]);
      }
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(schema);
  return Object.fromEntries(Object.entries(definitions).filter(([name]) => reachable.has(name)));
}

type Schema = { readonly [key: string]: JsonValue };
const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });
const objectSchema = (properties: Record<string, JsonValue>, required = Object.keys(properties)): Schema =>
  ({ type: "object", additionalProperties: false, properties, required });
const requiredKeys = (...keys: string[]): Schema => ({ required: keys, properties: Object.fromEntries(keys.map(key => [key, {}])) });
const ids: Schema = { type: "array", minItems: 1, maxItems: 8, uniqueItems: true, items: ref("Id") };
const fieldValues: Schema = { type: "object", maxProperties: 64, propertyNames: { type: "string", minLength: 1, maxLength: 128 }, additionalProperties: ref("FieldValue") };
const baseEntity = { context: ref("WriteContext"), mapId: ref("Id"), entityId: ref("Id") };
const editEntitySchema = { oneOf: [
  objectSchema({ ...baseEntity, action: { const: "move" }, at: ref("Point") }),
  objectSchema({ ...baseEntity, action: { const: "update" }, fields: fieldValues }),
  objectSchema({ ...baseEntity, action: { const: "remove" } }),
] };
const claimSchema=objectSchema({mapId:ref("Id"),layerIds:{type:"array",minItems:1,maxItems:8,uniqueItems:true,items:ref("Id")},region:ref("Rect")});
const claimsSchema:Schema={type:"array",minItems:1,maxItems:16,items:claimSchema};
/** paint_rect/fill: natural variation in one call, picked per cell by hash(seed,x,y). */
const randomAreaValue: Schema = objectSchema({
  random: { type: "array", minItems: 1, maxItems: 64, items: objectSchema({ tilesetId: ref("Id"), tileId: { type: "integer", minimum: 0, maximum: 4294967295 },
    flags: { type: "integer", minimum: 0, maximum: 7 }, weight: { type: "number", minimum: 0, maximum: 1000000 } }, ["tilesetId", "tileId"]) },
  seed: { type: "integer", minimum: 0, maximum: 4294967295 },
}, ["random"]);
const hardenedDefinitions: AgentToolDefinition[] = DEFINITIONS.map(tool => {
  let schema: Schema = tool.inputSchema;
  if (tool.name === "paint_rect" || tool.name === "fill")
    schema = { ...schema, properties: { ...(schema.properties as Record<string, JsonValue>), value: { oneOf: [ref("PaintValue"), randomAreaValue] } } };
  if(tool.name==="begin_edit")schema={...schema,properties:{...(schema.properties as Record<string,JsonValue>),collaboration:objectSchema({mode:{const:"regions"},claims:claimsSchema},["mode"])}};
  if (tool.name === "smart_brush" || tool.name === "draw_path") {
    // Inline source (prepared once per edit and reused) or an explicit prepared sourceId; exactly one.
    const prepareSource = (DEFINITIONS.find(t => t.name === "prepare_smart_source")!.inputSchema.properties as Record<string, JsonValue>)["source"]!;
    schema = { ...schema, properties: { ...(schema.properties as Record<string, JsonValue>), source: prepareSource, openEdges: { type: "boolean", default: true } },
      required: (schema.required as string[]).filter(key => key !== "sourceId"), oneOf: [requiredKeys("sourceId"), requiredKeys("source")] };
  }
  if (tool.name === "smart_brush") schema = { ...schema, allOf: [
    { if: { properties: { mode: { const: "area" } } }, then: { ...requiredKeys("region"), not: { anyOf: [requiredKeys("cells"), { ...requiredKeys("erase"), properties: { erase: { const: true } } }] } } },
    { if: { properties: { mode: { const: "road" } } }, then: { ...requiredKeys("cells"), not: requiredKeys("region") } },
  ] };
  if (tool.name === "place_stamp") schema = { ...schema,
    // Many copies of one stamp in a single call/action (trees, fences); at stays the single-copy form.
    properties: { ...(schema.properties as Record<string, JsonValue>), positions: { type: "array", minItems: 1, maxItems: 256,
      items: { type: "array", prefixItems: [{ type: "integer", minimum: 0, maximum: 4095 }, { type: "integer", minimum: 0, maximum: 4095 }], minItems: 2, maxItems: 2 } } },
    required: (schema.required as string[]).filter(key => key !== "at"), anyOf: [requiredKeys("at"), requiredKeys("positions")] };
  if (tool.name === "get_tile_catalog") schema = { ...schema, allOf: [
    { not: { ...requiredKeys("tileIds"), anyOf: [requiredKeys("offset"), requiredKeys("limit")] } },
    { if: requiredKeys("sheetRegion"), then: { ...requiredKeys("image"), properties: { image: { const: "sheet" } } } },
    { not: { ...requiredKeys("tileIds", "image"), properties: { tileIds: {}, image: { const: "sheet" } } } },
  ] };
  if (tool.name === "visual_ingest_reference") schema = {
    ...schema, properties: { ...(schema.properties as Record<string, JsonValue>), selectedReferenceToken: ref("Id") },
    required: ["context"], oneOf: [requiredKeys("pngBase64"), requiredKeys("selectedReferenceToken")],
  };
  const collaborationGuidance:Partial<Record<AgentToolDefinition["name"],string>>={
    begin_edit:" Optional collaboration:{mode:'regions',claims?} creates one shared draft. Claims are explicit existing map/layer rectangles. Omit claims for coordinator metadata preparation, then self join_edit once to assign regions before peers join. Prepare shared metadata before any spatial write or peer join. Returns memberId/memberRevision for explicit member-scoped CAS.",
    finish_edit:" In a collaborative draft this marks only your member ready; peers remain writable. Coordinator finish closes new joins. The group awaits human approval once all members are ready/stopped/cancelled.",
    cancel_edit:" In a collaborative draft with peers this rolls back only your bounded spatial contribution and releases your claims; peer contributions/shared setup remain pending. Before any peer joined, cancellation can discard the whole proposal. No agent can discard peers or approve the group.",
  };
  return { ...tool,description:tool.description+(collaborationGuidance[tool.name]??""), inputSchema: { ...schema, type: "object", $schema: "https://json-schema.org/draft/2020-12/schema" } };
});
function feature(name: AgentToolDefinition["name"], title: string, description: string, schema: Schema, readOnly: boolean): AgentToolDefinition {
  return { name, title, description, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false },
    inputSchema: { ...schema, type: "object", $schema: "https://json-schema.org/draft/2020-12/schema" } };
}
const layerIds16: Schema = { type: "array", minItems: 1, maxItems: 16, uniqueItems: true, items: ref("Id") };
const tileRef: Schema = objectSchema({ tilesetId: ref("Id"), tileId: { type: "integer", minimum: 0, maximum: 4294967295 } });
const gridCell: Schema = { oneOf: [
  { type: "null" },
  { const: "keep" },
  ref("Tile"),
  objectSchema({ collision: { type: "integer", minimum: 0, maximum: 2 } }),
  objectSchema({
    random: { type: "array", minItems: 1, maxItems: 64, items: objectSchema({ tilesetId: ref("Id"), tileId: { type: "integer", minimum: 0, maximum: 4294967295 },
      flags: { type: "integer", minimum: 0, maximum: 7 }, weight: { type: "number", minimum: 0, maximum: 1000000 } }, ["tilesetId", "tileId"]) },
    seed: { type: "integer", minimum: 0, maximum: 4294967295 },
  }, ["random"]),
] };
const gridLegend: Schema = { type: "object", maxProperties: 4096, propertyNames: { type: "string", minLength: 1, maxLength: 1 }, additionalProperties: gridCell };
const gridRows: Schema = { type: "array", minItems: 1, maxItems: 4096, items: { type: "string", minLength: 1, maxLength: 4096 } };
const layerName: Schema = { type: "string", minLength: 1, maxLength: 128 };
const GRID_DEFINITIONS: readonly AgentToolDefinition[] = [
  feature("paint_grid", "Paint Grid",
    "Paint a rectangle of varied tiles compactly: rows are equal-length strings, one character per map cell starting at origin (default {x:0,y:0}, x right/y down); legend maps each character to {tilesetId,tileId,flags?}, null (erase), \"keep\" (leave unchanged), {random:[{tilesetId,tileId,flags?,weight?}],seed?} (deterministic per cell; seed defaults to the map seed) or {collision:0|1|2} on collision layers. A space keeps the cell unless the legend defines it; any other unknown character is rejected. Target one layer with layerId or unique layerName, or several with layers:[{layerId|layerName,origin?,rows,legend?}] (top-level legend/origin are shared defaults; a layer's legend entries override). ≤16384 cells per layer, all applied as one action. read_region's default output uses the same shape. Requires begin_edit; context is optional.",
    { ...objectSchema({ context: ref("WriteContext"), mapId: ref("Id"), layerId: ref("Id"), layerName, origin: ref("Point"), rows: gridRows, legend: gridLegend,
      layers: { type: "array", minItems: 1, maxItems: 16, items: objectSchema({ layerId: ref("Id"), layerName, origin: ref("Point"), rows: gridRows, legend: gridLegend }, ["rows"]) } }, ["context", "mapId"]),
    oneOf: [
      { ...requiredKeys("rows"), anyOf: [requiredKeys("layerId"), requiredKeys("layerName")], not: requiredKeys("layers") },
      { ...requiredKeys("layers"), not: { anyOf: [requiredKeys("rows"), requiredKeys("layerId"), requiredKeys("layerName")] } },
    ] }, false),
  feature("replace_tiles", "Replace Tiles",
    "Replace every use of one tile with another (or erase it with to:null), keeping each cell's flip/rotation bits, like the editor's Tile değiştir. scope: \"region\" (mapId+region), \"layer\" (mapId+layerIds, whole layers), \"map\" (mapId) or \"world\" (every map in this edit). Without layerIds, all visible unlocked tile layers are used and protected ones are reported in warnings. No cell cap; returns the replaced count. Requires begin_edit; context is optional.",
    objectSchema({ context: ref("WriteContext"), scope: { type: "string", enum: ["region", "layer", "map", "world"] }, mapId: ref("Id"), layerIds: layerIds16, region: ref("Rect"),
      from: tileRef, to: { oneOf: [{ type: "null" }, tileRef] } }, ["context", "scope", "from", "to"]), false),
  feature("clear_region", "Clear Region",
    "Erase every tile/collision cell inside region (half-open map cells; default the whole map) on layerIds, or by default on all visible unlocked tile and collision layers. List an entity layer explicitly to also remove its entities inside the region. No cell cap. Requires begin_edit; context is optional.",
    objectSchema({ context: ref("WriteContext"), mapId: ref("Id"), region: ref("Rect"), layerIds: layerIds16 }, ["context", "mapId"]), false),
];
const batchNames = ["paint_cells", "paint_grid", "paint_rect", "paint_line", "place_stamp", "place_entity", "edit_entity"] as const;
const batchBranches = batchNames.map(name => {
  const source = name === "edit_entity" ? editEntitySchema : [...hardenedDefinitions, ...GRID_DEFINITIONS].find(t => t.name === name)!.inputSchema;
  function withoutContext(schema: Schema): Schema {
    // Branch-only unions (edit_entity) recurse; property schemas keep their keys and drop cross-key oneOf (validated server-side).
    if (Array.isArray(schema.oneOf) && !schema.properties) return { oneOf: schema.oneOf.map(branch => withoutContext(branch as Schema)) };
    const { context: _context, ...properties } = schema.properties as Record<string, JsonValue>;
    const required = (schema.required as string[]).filter(key => key !== "context");
    if (name === "place_stamp") { properties.allowCreateLayers = { const: false }; required.push("layerMapping"); }
    return objectSchema(properties, required);
  }
  return objectSchema({ tool: { const: name }, args: withoutContext(source) });
});
const goalBase = { region: ref("Rect") };
const goalSchema: Schema = { oneOf: [
  objectSchema({ ...goalBase, kind: { const: "reachability" }, from: ref("Point"), to: ref("Point"), collisionLayerIds: ids,
    blockedValues: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { type: "integer", enum: [1, 2] } }, emptyIsBlocked: { type: "boolean" } }),
  objectSchema({ ...goalBase, kind: { const: "region_unchanged" }, layerIds: ids, expectedDigest: { type: "string", pattern: "^[a-f0-9]{64}$" } }, ["kind", "region", "layerIds"]),
  objectSchema({ ...goalBase, kind: { const: "entity_count" }, layerIds: ids, typeId: ref("Id"), min: { type: "integer", minimum: 0, maximum: 1000000 }, max: { type: "integer", minimum: 0, maximum: 1000000 } }, ["kind", "region", "layerIds", "min", "max"]),
] };
const featureDefinitions = [
  feature("get_editor_context", "Get Editor Context", "Read the user's current map/layer/tool, bounded atlas/stamp/map selection, viewport and explicitly shared reference token. Context is observational: confirm intent before choosing a source. contextToken changes when selection or view changes, independently of world revision. No edits or automatic reference upload.", objectSchema({ context: ref("ReadContext") }), true),
  feature("edit_entity", "Edit Entity", "Move, update fields or remove an existing entity by mapId/entityId. move.at is map cells; point field values are native pixels. Preserves entity ID/type and validates merged fields, portal destinations and initial/current layer protection. Requires an edit, current revision and idempotency key.", editEntitySchema, false),
  feature("apply_operations", "Apply Operations", "Apply 1–32 sequential existing-ID paint_cells/paint_grid/paint_rect/paint_line/place_stamp/place_entity/edit_entity operations with one optional outer context. Each item is {tool,args} without context. Stamps require explicit existing layerMapping and cannot create layers. Complete sequential preflight rejects the whole batch before mutation; children consume mutation/memory budgets and aggregate planned cells must be ≤65536. No lifecycle, creation, fill, source preparation or tags. Replay creates no duplicates; approval joins one world undo group.", objectSchema({ context: ref("WriteContext"), operations: { type: "array", minItems: 1, maxItems: 32, items: { oneOf: batchBranches } } }), false),
  feature("validate_goals", "Validate Goals", "Check explicit map goals in bounded regions, separately from validate_map structural checks. reachability uses FOUR orthogonal neighbors and caller-selected collisionLayerIds in map stack order: uppermost nonzero value wins, blockedValues identifies blocked decisions and emptyIsBlocked defines cells with no decision. Never infers terrain or visual walkability. region_unchanged resolves tile identities/orientations, collision, entities and visual layer visibility/opacity; omit expectedDigest to capture a baseline (passed/valid:null), then supply it after edits. Digests bind map/layers/region and survive unrelated palette appends. entity_count uses explicit entity layers, optional existing typeId and inclusive min/max. ≤16 checks, ≤65536 aggregate cell-layer scans plus bounded entities; no writes.", objectSchema({ context: ref("ReadContext"), mapId: ref("Id"), checks: { type: "array", minItems: 1, maxItems: 16, items: goalSchema } }), true),
];
const controlObject = (properties: Record<string, JsonValue>, required: string[] = []): Schema => ({ type: "object", additionalProperties: false, properties, required });
const controlEnumeration = (...values: string[]): Schema => ({ type: "string", enum: values });
const controlInteger = (minimum: number, maximum: number): Schema => ({ type: "integer", minimum, maximum });
const bool: Schema = { type: "boolean" };
const id: Schema = { $ref: "#/$defs/Id" };
const context = { context: { $ref: "#/$defs/ReadContext" } };
const panel = controlEnumeration("tileset", "stamps", "project", "recent", "inspector", "history", "layers", "entities", "color", "aiActivity");
const zone = controlEnumeration("left", "right", "bottom");
const controlNullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: "null" }] });
const controlPatch = (properties: Record<string, JsonValue>): Schema => ({ ...controlObject(properties), minProperties: 1 });
const hex: Schema = { type: "string", pattern: "^#(?:[A-Fa-f0-9]{3}|[A-Fa-f0-9]{4}|[A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$" };
function controlTool(name: AgentToolDefinition["name"], description: string, schema: Schema, readOnly = false): AgentToolDefinition {
  return { name, title: name.split("_").map(w => w[0]!.toUpperCase() + w.slice(1)).join(" "), description,
    annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false }, inputSchema: { ...schema, type: "object", $schema: "https://json-schema.org/draft/2020-12/schema" } };
}
export const EDITOR_CONTROL_DEFINITIONS: readonly AgentToolDefinition[] = [
  controlTool("get_export_settings", "Read the current world export target, PNG scale, Unity tile/collision/texture preferences, automatic Unity export flag and per-map excluded layers. No output paths, file handles or tokens. Does not export or write document data.", controlObject(context), true),
  controlTool("configure_export", "Patch export preferences for the current world. Supports target, PNG scale and Unity tiles/collision/copy-textures and autoUnity flags through the normal export-settings persistence. No folder/path or file output. Turning on autoUnity affects later saves only when a destination is already configured. Pending AI proposals remain excluded by normal save/export gates. Optional world context prevents writing a replaced world.", controlObject({...context,preferences:controlPatch({target:controlEnumeration("unity","png","json","tmj","zip","godot","defold"),pngScale:{type:"integer",enum:[1,2,4]},unityTiles:bool,unityCollision:bool,copyTextures:bool,autoUnity:bool})},["preferences"])),
  controlTool("get_editor_state", "Inspect live editor view, tool/brush/rectangle/selection/pixel options, tileset filters, panel layout, locale, effective and default shortcuts, and capability boundaries. Works on welcome screen. Optional context binds this window's current world. No secrets or filesystem paths. UI state is independent of document revision and pending review.", controlObject(context), true),
  controlTool("configure_editor", "Set explicit UI controls without changing document data or requiring begin_edit. Available during running/stopped/awaitingApproval proposals. Activate map/layer, select existing tile/stamp/entity, set marquee, tile/pixel tools, brush/rectangle options, grid/major grid/collision/minimap/rulers/canvas mode, camera view/zoom/center (map cells), atlas filter/view/zoom and pixel colors/mirrors. All target IDs and bounds validate before applying settings; no painting, PNG write, undo or proposal approval. Camera animation may settle after reply. Optional context rejects replaced worlds.", controlPatch({ ...context,
    activeMapId: id, activeLayerId: id, tool: controlEnumeration("line", "brush", "eraser", "fill", "rect", "select", "eyedropper", "entity", "hand"), mode: controlEnumeration("tile", "pixel"),
    gridVisible: bool, collisionOverlay: bool, minimapVisible: bool, rulersVisible: bool, panelsHidden: bool,
    majorGrid: { ...controlObject({ interval: { type: "integer", enum: [0, ...Array.from({length:63}, (_,i)=>i+2)] }, x: controlInteger(-1000000,1000000), y: controlInteger(-1000000,1000000) }, ["interval","x","y"]) },
    brush: controlPatch({ size: controlInteger(1,16), shape: controlEnumeration("square","circle"), collisionValue: controlInteger(0,2) }),
    rectangle: controlPatch({ mode: controlEnumeration("filled","outline"), thickness: controlInteger(1,8) }),
    selection: controlPatch({ scope: controlEnumeration("active","visible"), mode: controlEnumeration("rectangle","connected"), pickScope: controlEnumeration("active","all"), region: controlNullable({ $ref: "#/$defs/Rect" }), tile: controlNullable({ $ref: "#/$defs/Tile" }), stampId: controlNullable(id), entityId: controlNullable(id), entityTypeId: id }),
    camera: controlPatch({ view: controlEnumeration("level","world"), zoom: {type:"number",minimum:0.002,maximum:32}, center: {$ref:"#/$defs/Point"}, frame: bool }),
    tileset: controlPatch({ activeId: id, view: controlEnumeration("single","all"), query: {type:"string",maxLength:256}, zoom: controlNullable({type:"number",minimum:0.125,maximum:32}) }),
    pixel: controlPatch({ size: controlInteger(1,64), shape: controlEnumeration("square","circle"), scope: controlEnumeration("cell","world"), fillMode: controlEnumeration("contiguous","global"), filled: bool, mirrorH: bool, mirrorV: bool, foreground: hex, background: hex }),
  })),
  controlTool("configure_layout", "Show/hide/reveal and move/reorder panels, split groups, expand/collapse/hide dock zones, resize zones (UI clamps normal size limits), or reset layout. Persists through the normal dock settings writer. Independent of document review; cannot approve edits. group/index are zero-based, split creates a group at start/end.", {oneOf:[
    controlObject({...context,action:{const:"reset"}},["action"]),
    {...controlObject({...context,action:{const:"zone"},zone,state:controlEnumeration("expanded","collapsed","hidden"),size:controlInteger(64,1000)},["action","zone"]),anyOf:[{required:["state"],properties:{state:{}}},{required:["size"],properties:{size:{}}}]},
    controlObject({...context,action:controlEnumeration("show","hide"),panel},["action","panel"]),
    controlObject({...context,action:{const:"move"},panel,zone,group:controlInteger(0,20),index:controlInteger(0,20),split:controlEnumeration("start","end")},["action","panel","zone"]),
  ]}),
  controlTool("configure_application", "Persist locale and shortcut overrides with the application's serialized settings writer, rejecting unknown commands, malformed chords and shortcut conflicts. null removes an override and restores defaults; [] unbinds. Read get_editor_state for available locales and defaults. Rejects an open settings preview to preserve the user's draft. Never changes MCP server/token or writes document/PNG data. Works without a world and during proposal review.", controlPatch({...context,locale:{type:"string",minLength:1,maxLength:32},shortcuts:{type:"object",maxProperties:512,propertyNames:{type:"string",minLength:1,maxLength:128},additionalProperties:controlNullable({type:"array",maxItems:4,uniqueItems:true,items:{type:"string",minLength:1,maxLength:64}})}})),
  controlTool("list_editor_commands", "Discover current command IDs, translated labels, categories, enabled/check state, shortcuts and remoteExecutable status/reason. Query matches ID/title/category. Only the explicit UI allowlist can execute via run_editor_command; document mutations use transaction tools and AI approval remains human-only. Paginated, at most 128 commands per page.", controlObject({...context,query:{type:"string",maxLength:256},offset:controlInteger(0,10000),limit:controlInteger(1,128)}), true),
  controlTool("editor_ui", "Editor UI controls through one tool: action selects get_editor_state/configure_editor/configure_layout/configure_application/list_editor_commands/run_editor_command/get_export_settings/configure_export; args are that tool's arguments.",
    controlObject({ ...context, action: controlEnumeration("state", "configure", "layout", "application", "commands", "run_command", "export_settings", "configure_export"), args: { type: "object" } }, ["action"])),
  controlTool("run_editor_command", "Invoke one enabled UI command from list_editor_commands where remoteExecutable=true. Explicit allowlist covers view navigation/toggles, tool switches, settings dialogs, palette, pixel colors and selection-only commands. Does not execute arbitrary command IDs, file operations, document mutations or AI approval/discard. This action is not replay-cached: toggles execute once per call; use configure_editor/configure_layout for retry-safe absolute setters.", controlObject({...context,commandId:id},["commandId"])),
];

const LIBRARY_DEFINITIONS: readonly AgentToolDefinition[] = [
  feature("edit_map", "Edit Map Metadata", "Rename an existing transaction target map and/or move it in world view. world coordinates are signed whole pixels (not map cells). IDs, files and map cells remain stable. Requires begin_edit; joins the same pending approval, cancellation, replay and world undo action as painting.", { ...objectSchema({ context: ref("WriteContext"), mapId: ref("Id"), name: {type:"string",minLength:1,maxLength:128}, world: objectSchema({x:{type:"integer",minimum:-1000000000,maximum:1000000000},y:{type:"integer",minimum:-1000000000,maximum:1000000000}}) }, ["context","mapId"]), anyOf: [requiredKeys("name"),requiredKeys("world")] }, false),
  feature("edit_stamp", "Edit Stamp Library", "Update a saved stamp's name/category/tags/favorite, duplicate it with a unique stable ID, or remove it from the library. Already placed map cells remain ordinary tiles. Metadata and library membership are staged in the current edit; cancellation restores originals and approval joins one reversible world action. Does not touch source PNGs or regenerate artwork. Requires begin_edit and replay key.", {oneOf:[
    objectSchema({context:ref("WriteContext"),stampId:ref("Id"),action:{const:"update"},props:{...objectSchema({name:{type:"string",minLength:1,maxLength:128},category:{type:"string",maxLength:128},tags:{type:"array",maxItems:16,items:{type:"string",maxLength:48}},favorite:{type:"boolean"}},[]),minProperties:1}}),
    objectSchema({context:ref("WriteContext"),stampId:ref("Id"),action:{const:"duplicate"},name:{type:"string",minLength:1,maxLength:128}}),
    objectSchema({context:ref("WriteContext"),stampId:ref("Id"),action:{const:"remove"}}),
  ]}, false),
  feature("get_world_settings", "Get World Settings", "Read this world's new-map tile size, dimensions, layer template, canvas background and Unity defaults. Inspect before configure_world. No changes.", objectSchema({context:ref("ReadContext")}), true),
  feature("configure_world", "Configure World", "Patch world defaults for future maps: tile size, new-map dimensions, layer template and canvas background (#rrggbb or null). Existing maps/tiles/pixels keep their dimensions. Requires begin_edit; pending review, discard and approved undo cover settings alongside document edits. No path, auto-export or server/token changes. UI view/preferences use configure_editor/configure_application.", objectSchema({context:ref("WriteContext"),settings:{...objectSchema({tileWidth:{type:"integer",minimum:1,maximum:1024},tileHeight:{type:"integer",minimum:1,maximum:1024},newLevel:{...objectSchema({width:{type:"integer",minimum:1,maximum:4096},height:{type:"integer",minimum:1,maximum:4096}},[]),minProperties:1},layerTemplate:{type:"array",maxItems:128,items:objectSchema({name:{type:"string",minLength:1,maxLength:128},kind:{type:"string",enum:["tile","collision","entity"]}})},background:{anyOf:[{type:"null"},{type:"string",pattern:"^#[a-fA-F0-9]{6}$"}]}},[]),minProperties:1}}), false),
];
const TILED_DEFINITIONS: readonly AgentToolDefinition[] = [
  feature("import_tiled", "Import Tiled Map", "Import a Tiled map (absolute local .tmx/.tmj/.json path; referenced .tsx/.tsj tilesets and PNG sheets are read beside it, ≤32 MB each, never written) as a new provisional map in your edit: orthogonal tile layers with flips; tileset PNGs are copied into the world (identical ones reused). Returns map/layer ids, tilesets and the unsupported list (object/image layers, animations, …); prefer this over tracing when a pack ships sample maps.", objectSchema({ context: ref("WriteContext"), path: { type: "string", minLength: 1, maxLength: 4096 }, name: { type: "string", minLength: 1, maxLength: 128 }, world: objectSchema({ x: { type: "integer", minimum: -1000000000, maximum: 1000000000 }, y: { type: "integer", minimum: -1000000000, maximum: 1000000000 } }) }, ["context", "path"]), false),
];
const LIFECYCLE_DEFINITIONS: readonly AgentToolDefinition[] = [
  feature("resume_edit", "Resume Edit", "Continue your own draft from this connection after a disconnect, client restart, lease expiry, Durdur or finish_edit. Pass transactionId and the resumeToken that begin_edit returned. Works while the draft is running, orphaned, stopped or awaitingApproval: it rebinds ownership to you and reopens writing (the review bar returns to AI çalışıyor). Previous work is kept. Fails once the user approved or discarded the draft; then begin a new edit. Exclusive drafts only.", objectSchema({ context: ref("ReadContext"), transactionId: ref("Id"), resumeToken: ref("ResumeToken") }, ["transactionId", "resumeToken"]), false),
];
const JOIN_DEFINITIONS:readonly AgentToolDefinition[]=[feature("join_edit","Join Collaborative Edit","Join an existing shared draft as your authenticated client, claiming 1–16 immutable rectangles on explicit existing map/layer IDs. Overlap on the same map/layer fails REGION_CONFLICT before mutation; disjoint regions can share one layer. Founder begin_edit may omit claims for prep-only setup, then call join_edit once to assign its own claims before peers join. Peers join only while coordinator is open and has claims. Global metadata is frozen after the first spatial write or first peer join. Returns memberId/memberRevision; subsequent writes may use expectedMemberRevision instead of strict global expectedRevision (exactly one). finish_edit submits only your member; cancel_edit rolls back only your spatial contribution, preserving peers/shared setup. Human approval/discard applies to the combined draft.",objectSchema({context:ref("ReadContext"),transactionId:ref("Id"),idempotencyKey:ref("Key"),expectedRevision:ref("Revision"),claims:claimsSchema}),false)];
/** Map writes are drafts the human approves or discards (Onayla/Vazgeç), so they
 * are not destructive. Only tools that persist outside that review are. */
const PERSISTENT_WRITES: ReadonlySet<string> = new Set(["set_tags", "configure_export", "configure_layout", "configure_application"]);
/** Repeating the same arguments leaves the same state (no new IDs, no toggles). */
const IDEMPOTENT_WRITES: ReadonlySet<string> = new Set([
  "resume_edit", "finish_edit", "cancel_edit", "paint_cells", "paint_grid", "replace_tiles", "clear_region", "paint_rect", "paint_line", "fill", "smart_brush", "draw_path", "place_stamp",
  "resize_map", "edit_map", "configure_world", "set_tags", "configure_export", "configure_editor", "configure_layout", "configure_application",
]);
function annotate(tool: AgentToolDefinition): AgentToolDefinition["annotations"] {
  if (tool.annotations.readOnlyHint) return tool.annotations;
  return { ...tool.annotations, destructiveHint: PERSISTENT_WRITES.has(tool.name), ...(IDEMPOTENT_WRITES.has(tool.name) ? { idempotentHint: true } : {}) };
}
/** C2: context is optional on every tool except collaborative join, which keeps its explicit rules. */
function optionalContext(schema: Schema): Schema {
  const out: Record<string, JsonValue> = { ...schema };
  if (Array.isArray(schema.required)) out.required = (schema.required as string[]).filter(key => key !== "context");
  for (const key of ["oneOf", "anyOf"] as const)
    if (Array.isArray(schema[key])) out[key] = (schema[key] as Schema[]).map(branch => optionalContext(branch));
  return out;
}
/** Reference images (picture → map) and visual options of existing read tools. */
const { VISION_DEFINITIONS, withVisionOptions } = (() => {
  const ref = (name: string): Schema => ({ $ref: `#/$defs/${name}` });
  const object = (properties: Record<string, JsonValue>, required: string[]): Schema => ({ type: "object", additionalProperties: false, properties, required });
  const fit: Schema = { type: "string", enum: ["stretch", "contain"], default: "stretch", description: "stretch maps the whole (trimmed) picture onto the region; contain keeps its aspect ratio and leaves uncovered cells unchanged." };
  const sourceRect: Schema = { ...ref("Rect"), description: "Picture pixels that show the map. Default: the picture with dark editor gutters/letterboxing trimmed automatically." };
  const mapping = { referenceId: ref("Id"), mapId: ref("Id"), region: ref("Rect"), fit, sourceRect };
  const optionalContext = { context: { ...ref("ReadContext"), description: "Optional; the current world is used when omitted." } };
  const ids = (max: number): Schema => ({ type: "array", minItems: 1, maxItems: max, uniqueItems: true, items: ref("Id") });
  function tool(name: string, title: string, description: string, schema: Schema): AgentToolDefinition {
    return {
      name: name as AgentToolDefinition["name"], title, description,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      inputSchema: { ...schema, type: "object", $schema: "https://json-schema.org/draft/2020-12/schema" },
    };
  }
  const legendValue: Schema = { anyOf: [
    ref("Tile"), { type: "null" }, { const: "keep" },
    { type: "string", minLength: 1, maxLength: 48, description: "AI tag word such as \"su\" or \"water\"." },
    randomAreaValue,
    object({ stampId: ref("Id"), ground: { anyOf: [ref("Tile"), { type: "null" }, randomAreaValue] } }, ["stampId"]),
    object({ overlay: ref("Tile"), ground: { anyOf: [ref("Tile"), { type: "null" }, randomAreaValue] } }, ["overlay"]),
  ] };

  const VISION_DEFINITIONS: readonly AgentToolDefinition[] = [
    tool("reference_add", "Add Reference Image",
      "Load the user's reference picture into the editor so the reference_* tools can use it. path is an absolute local .png/.jpg/.jpeg/.webp file (≤16 MB, read once, decoded in the editor, never copied or written); imageBase64 is the raw file bytes in base64 (≤1 MiB request); selectedReferenceToken comes from get_editor_context. Large pictures are downscaled to fit 2048 px. Pictures the user dropped onto the AI panel are already listed in get_session.references — no need to add them. Returns referenceId.",
      { ...object({ ...optionalContext, path: { type: "string", minLength: 1, maxLength: 4096 }, imageBase64: { type: "string", minLength: 4, maxLength: 1000000 }, selectedReferenceToken: ref("Id"), name: { type: "string", minLength: 1, maxLength: 128 } }, []),
        oneOf: [requiredKeys("path"), requiredKeys("imageBase64"), requiredKeys("selectedReferenceToken")] }),
    tool("reference_view", "View Reference On Map Grid",
      "Show a reference picture resampled onto the map cell grid (same gutters, coordinates and scale as render_preview), so picture features can be read as map cells. fit:stretch (default) or contain; optional region crops map cells; sourceRect overrides the automatic trim of dark gutters. Writes nothing.",
      object({ ...optionalContext, ...mapping, grid: { type: "boolean", default: true }, coordinates: { type: "boolean", default: true }, zoom: { type: "integer", minimum: 1, maximum: 8 }, maxSide: { type: "integer", minimum: 256, maximum: 2048, default: 1536 } }, ["referenceId", "mapId"])),
    tool("reference_quantize", "Quantize Reference To Tiles",
      "Turn a reference picture into a ready-to-paint tile grid proposal. Each map cell gets the nearest candidate tile by colour and structure (mode render: screenshots/renders, also scaled or blurred) or by dominant colour (mode sketch: flat-colour drawings; auto picks). Render mode also proposes the overlay layer (transparent tiles over ground) and reports stamp placements it recognises. Returns grid.layers in paint_grid format (rows + legend per layer; space = keep), per-cell confidence summary with low-confidence cells, and a preview PNG of the proposal. For sketches, pass colorLegend {\"#rrggbb\": Tile | {random:[...]} (varied ground, kept as a random legend entry) | tag word | {stampId,ground?} | {overlay,ground?} | null | \"keep\"}; without it every colour gets its closest tile and data.palette lists the colours found. candidates limits tilesets/tiles/stamps. layers.ground/overlay choose target layers (overlay:null = ground only). Writes nothing: paint the grid with paint_grid, place stamps with place_stamp, then render_compare.",
      object({ ...optionalContext, ...mapping,
        mode: { type: "string", enum: ["auto", "render", "sketch"], default: "auto" },
        candidates: object({ tilesetIds: ids(32), tiles: { type: "array", minItems: 1, maxItems: 1024, items: ref("Tile") }, stamps: { type: "array", maxItems: 128, uniqueItems: true, items: ref("Id") } }, []),
        layers: object({ ground: ref("Id"), overlay: { anyOf: [ref("Id"), { type: "null" }] } }, []),
        colorLegend: { type: "object", maxProperties: 32, propertyNames: { type: "string", pattern: "^#?(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$" }, additionalProperties: legendValue },
        preview: { type: "boolean", default: true },
      }, ["referenceId", "mapId"])),
    tool("render_compare", "Compare Map With Reference",
      "Check the map against the user's picture (referenceId) or against the state before your edit (baseline:\"draftStart\"). mode side (default): picture/before left, current map right, same grid; overlay: current map blended over the picture; diff: dimmed map with mismatching/changed cells outlined. Returns mismatch {cells, ratio, sample} to fix next. Writes nothing.",
      { ...object({ ...optionalContext, mapId: ref("Id"), referenceId: ref("Id"), baseline: { const: "draftStart" }, mode: { type: "string", enum: ["side", "overlay", "diff"], default: "side" }, region: ref("Rect"), fit, sourceRect, layerIds: ids(32), maxSide: { type: "integer", minimum: 256, maximum: 2048, default: 1536 } }, ["mapId"]),
        oneOf: [requiredKeys("referenceId"), requiredKeys("baseline")] }),
  ];

  /** Visual additions to existing read tools (kept here so the frozen catalogue stays readable). */
  function withVisionOptions(tool: AgentToolDefinition): AgentToolDefinition {
    const schema = tool.inputSchema;
    const properties = schema.properties as Record<string, JsonValue> | undefined;
    if (!properties) return tool;
    if (tool.name === "render_preview") return { ...tool,
      description: "Inspect a real PNG of the current live/tentative map. mapId required; optional region (map cells). Pixels per cell are always whole: zoom 1–8 enlarges close crops, large maps shrink by 1/2, 1/3…; maxSide (content, ≤2048) bounds the size. grid:true draws the cell grid with brighter major lines every 8 cells; coordinates:true adds coordinate gutters and labels at major intersections. highlight:\"draft\" outlines cells your pending edit changed, \"lastCall\" outlines the area of your last write. Entities show as labelled cell boxes. Hidden layers stay hidden; collision only for requested collision layerIds. Metadata gives contentRect, scale, cellSize and pixelOrigin. Writes nothing.",
      inputSchema: { ...schema, properties: { ...properties, zoom: { type: "integer", minimum: 1, maximum: 8 }, highlight: { type: "string", enum: ["draft", "lastCall"] } } } };
    if (tool.name === "get_tile_catalog") return { ...tool,
      description: tool.description + " Compact by default: items are {tileId, tags?, note?}; details:true adds sourceRect, tagStatus, fingerprint (needed for set_tags) and image placements. The tiles image is a near-square grid (≤1568 px) with each tileId printed under its tile; sheet mode prints tile ids in every cell.",
      inputSchema: { ...schema, properties: { ...properties, details: { type: "boolean", default: false } } } };
    if (tool.name === "list_stamps") return { ...tool,
      description: tool.description + " includeSheet:true returns one contact-sheet PNG of the listed page: every stamp drawn at its real cell size with name and width×height; data.image.sheet maps each stampId to its rectangle.",
      inputSchema: { ...schema, properties: { ...properties, includeSheet: { type: "boolean", default: false } } } };
    return tool;
  }
  return { VISION_DEFINITIONS, withVisionOptions };
})();
export const TOOL_DEFINITIONS: readonly AgentToolDefinition[] = [...hardenedDefinitions, ...LIFECYCLE_DEFINITIONS, ...GRID_DEFINITIONS, ...featureDefinitions, ...EDITOR_CONTROL_DEFINITIONS, ...LIBRARY_DEFINITIONS, ...TILED_DEFINITIONS, ...JOIN_DEFINITIONS, ...VISION_DEFINITIONS].map(withVisionOptions).map(tool => {
  const inputSchema = (tool.name === "join_edit" ? tool.inputSchema : optionalContext(tool.inputSchema)) as AgentToolDefinition["inputSchema"];
  return { ...tool, annotations: annotate(tool), inputSchema: { ...inputSchema, $defs: reachableSchemaDefinitions(inputSchema, SHARED_DEFS) } };
});

/** Code-unit key order, LF, two spaces and one final newline, independent of host locale. */
export function canonicalJson(value: unknown, pretty = true): string {
  function sorted(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(item => sorted(item));
    if (input !== null && typeof input === "object") {
      return Object.fromEntries(Object.keys(input).sort().map(key => [key, sorted((input as { readonly [key: string]: unknown })[key]!)]));
    }
    return input;
  }
  return pretty ? JSON.stringify(sorted(value), null, 2) + "\n" : JSON.stringify(sorted(value));
}

