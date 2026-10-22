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
    "description": "World identity from get_session. Never infer identity from selected tabs.",
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
    "description": "Use current worldSessionId, begin_edit transactionId, latest response revision and a fresh idempotencyKey for each distinct write. Retry identical payload/key only.",
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
    "description": "Start here. Inspect the open world, active map/layer, maps, revision, clients and transaction. No arguments or open world required. Use returned worldSessionId in every subsequent context. Workflow: get_session → inspect catalogs/maps → begin_edit → paint/place/preview/validate → finish_edit → wait for human Onayla or Vazgeç. Poll transactionId to learn the final approval/cancellation outcome. Never approve or save yourself.",
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
    "description": "Inspect one map and its layers without changing the user’s selected map. Obtain stable mapId from get_session and layerId/kind/visibility/locks here before painting. context is {worldSessionId}. Dimensions are cells; tileWidth/tileHeight are native pixels.",
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
    "description": "Read a bounded rectangle from explicit mapId and layerIds. context is {worldSessionId}. Coordinates are zero-based map cells, x right/y down; region is half-open {x,y,width,height}. Cells are row-major local legend refs (0 empty), not document palette indices; collision layers use raw 0/1/2. Maximum 4096 cells/layer, 16384 total, 8 layers, 256 entities.",
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
    "description": "Discover tileset IDs, names, native tile sizes and sheet grid dimensions before choosing art. context is {worldSessionId}. Page limit 1–128 (default 64); reuse nextCursor unchanged with the same filters/world revision. Then call get_tile_catalog with images to inspect the actual art.",
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
    "description": "Sheet mode is a continuous atlas crop with compact sheet grid/source metadata and no per-tile placements. sheetRegion determines the row-major metadata page; offset/nextOffset are relative to that region. Sheet mode cannot combine tileIds. Inspect real tile art and stable numeric tile IDs before choosing tiles. context is {worldSessionId}. image:\"tiles\" returns a labelled contact sheet (≤64 tiles); image:\"sheet\" returns a labelled sheetRegion in tileset grid cells; image:\"none\" returns metadata only (≤128). Choose either tileIds or offset/limit. scale is 1,2,4. One ID gives a cropped tile. sourceRect is native source pixels; labels occupy separate gutters. PNG ≤2048 px/side and 4 MiB. Select a smaller page/region when too large. Tile meanings are not inferred from IDs.",
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
    "description": "Discover reusable multilayer stamps, source-layer IDs, native size, smart usages and semantic tags. context is {worldSessionId}. Search normalized names, categories, library tags and current semantic labels with query; paginate ≤32 records (default 16); previewStampId adds one real PNG. Use place_stamp for flat objects, or prepare_smart_source only for suitable smart art.",
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
    "description": "Begin one tentative action after get_session. context is {worldSessionId}; expectedRevision is the latest response revision, idempotencyKey is a unique 8–128 character key, requestLabel describes the user’s request, mapIds names 1–8 explicit targets. Save drains before running. Use returned transactionId in write contexts. One world writer, ≤256 mutation calls, 262144 planned cell writes, 64 MiB retained bytes. Running lifetime ≤30 minutes. finish_edit requests human review; only the user approves. User painting/save is blocked until approval/discard.",
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
    "description": "Finish the drawing and request human review; returns awaitingApproval immediately. context is {worldSessionId,transactionId,idempotencyKey,expectedRevision}, using the latest response revision and a fresh key. Optional summary describes changes. Writes are sealed and locks remain. Only the user can Onayla (one undo row) or Vazgeç (rollback). Poll get_session(transactionId); never attempt to approve/save via a tool.",
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
    "description": "Discard your owned tentative edit and restore its original maps, palettes and project metadata. context is {worldSessionId,transactionId,idempotencyKey,expectedRevision}; unlike other writes, cancellation accepts a stale expectedRevision. Provisional maps disappear. Independently written semantic tags survive. User may also discard locally.",
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
    "description": "Write sparse explicit cells on a tile or collision layer (≤4096 cells/call). Each cell is {x,y,value}; zero-based map cells, x right/y down. value is {tilesetId,tileId,flags?}, null to erase, or {collision:0|1|2} for collision layers only. flags are compact D4 H=1,V=2,D=4. All coordinates must fit; locked/hidden layers reject. Requires begin_edit and context {worldSessionId,transactionId,idempotencyKey,expectedRevision}. Use latest response revision, fresh key per distinct call; repeat identical arguments/key only to retry. Changes remain tentative until human approval.",
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
    "description": "Fill a half-open map-cell region {x,y,width,height} on explicit mapId/layerId with one value; optional outline 1–16 cells, default 0 fills. value is a tile reference, null (erase), or collision value on a collision layer. ≤4096 planned cells; full region must fit, protected layers reject. Requires begin_edit and write context {worldSessionId,transactionId,idempotencyKey,expectedRevision}; update revision from each response. Split large ground fills into bounded rectangles. Finish with finish_edit for human review.",
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
    "description": "Draw a straight Bresenham line from/to in zero-based map cells, y down. Square width 1–16; even widths extend one extra cell toward positive coordinates. Entire footprint must fit; ≤4096 cells including width. value is tile/null or collision on matching layer. Requires begin_edit and write context with current expectedRevision, transactionId, worldSessionId and fresh idempotencyKey. For smart connected art use draw_path instead.",
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
    "description": "Four-neighbor flood fill inside an explicit half-open region, starting at start in map cells. Matches the full original value including orientation. maxCells 1–4096; exceeding it rejects before any mutation. Never unrestricted whole-world fill. Explicit mapId/layerId and compatible value required. Requires begin_edit and context {worldSessionId,transactionId,idempotencyKey,expectedRevision}; refresh revision after writes.",
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
    "description": "Prepare suitable existing art for smart_brush/draw_path inside the current edit. source is {stampId} or {tilesetId,region} with region in tileset grid cells (≤32×32). Native tile width AND height must match map; no rescaling. Returns opaque sourceId bound to this transaction/map, band b and usages (area, optionally road). Non-smart art fails; force:true explicitly overrides detection with band 1 and does not prove the art is suitable. Inspect catalog first; ordinary paint/stamps are appropriate when art lacks a smart layout. Generated atlases are transaction-owned. ≤30 seconds, 64 MiB. Requires write context with latest revision.",
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
    "description": "Paint with a prepared sourceId on its bound map and explicit layerId. mode:\"area\" uses only region (map cells) and erase:false; mode:\"road\" uses distinct cells at macro-cell top-lefts aligned to source band b, optionally erase:true. Neighbor connection repairs are included in ≤4096 planned writes. Use prepare_smart_source first; check returned usages. Orientation 0–7 uses D4 bits; quarter turns require square cells. Multilayer source mapping must be unambiguous. Requires begin_edit and write context {worldSessionId,transactionId,idempotencyKey,expectedRevision}.",
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
    "description": "Draw a connected path/river using a prepared road-capable sourceId, explicit mapId/layerId and 2–128 map-cell points (x right, y down). Snaps points by floor(cell/b) to source band b, joins orthogonally, and expands square width 1–16 macro cells (actual tile width=width*b). ≤4096 writes including neighbor repairs. kind:\"path\"|\"river\" records intent only; YOU select suitable art. No automatic water/bridge art. Place bridges separately with place_stamp or paint. Requires write context with latest revision; preview before finish_edit.",
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
    "description": "Place an existing stamp by ID with transformed top-left at at (map cells). rotation 0–3 quarter turns occurs before flipX/flipY. Uses compatible source/destination layers; supply layerMapping [{sourceLayerId,targetLayerId}] when ambiguous, or allowCreateLayers:true for missing layers. emptyCells:\"skip\" (default) preserves destination under holes; \"erase\" clears them. ≤4096 writes across layers; complete transformed bounds must fit. Protected layers reject atomically. Requires begin_edit and context {worldSessionId,transactionId,idempotencyKey,expectedRevision}.",
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
    "description": "Inspect available built-in spawn/portal and user entity schemas, field names/types/defaults/enums. context is {worldSessionId}. Use an existing typeId with place_entity. Tools cannot invent entity types or fields.",
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
    "description": "Resize an explicit map from its top-left, preserving native tile dimensions. width/height are cells (1–4096, area ≤1048576). Occupied content outside new bounds requires allowCrop:true; initially protected content cannot be silently cropped. Result is tentative/undoable. Requires begin_edit and context {worldSessionId,transactionId,idempotencyKey,expectedRevision}.",
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
    "description": "Inspect a real PNG of the current live/tentative map before finish_edit. context is {worldSessionId}; mapId required. Optional region is half-open map cells; otherwise whole map. maxSide (≤2048) fits large maps with nearest-neighbor scaling. grid:true and coordinates:true add cell grid and readable coordinate gutters; response image metadata gives contentRect, scale, pixelOrigin and cellSize for exact mapping. Hidden layers stay hidden. Collision overlay only for expressly requested collision layerIds. Optional entity markers are diagnostics. ≤1 PNG, 4 MiB, 30 seconds; no file export or save. Review both overview and close crop.",
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
    "description": "Read-only structural validation of explicit mapId, optional half-open map-cell region. context is {worldSessionId}. Reports invalid references/bounds/entity fields/portals/generated sources; existing protected content is not an error. No aesthetic, walkability or semantic guarantees. Paginate ≤256 issues (default 128) using returned revision-bound nextCursor. Whole-map scan is not subject to paint’s 4096-cell limit. Use before finish_edit.",
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
    "description": "Discover semantic labels and tiles/stamps needing annotation. context is {worldSessionId}, with no transaction required; allowed during edits. kind tiles|stamps; optional tilesetId; optional query searches Turkish/English normalized labels and notes with small explicit aliases; status all|current|missing|stale (default current with query, otherwise missing), limit ≤128 and opaque cursor. Returns current fingerprints and retained stale/orphan records. Inspect actual art with get_tile_catalog/list_stamps before proposing labels. Tags do not define terrain/collision.",
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
    "description": "Replace independent semantic tags for existing targets; [] clears. context is {worldSessionId,idempotencyKey} ONLY (no transactionId or expectedRevision). entries contain target, expectedFingerprint from get_tags, tags and optional note. ≤128 targets/batch, ≤16 tags of 1–48 chars, note ≤256. Fingerprint mismatch/duplicate targets rejects the batch. Written independently within 500ms, even while map edit pending; neither discard nor undo removes tags. Never changes PNGs/terrain/collision.",
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
const hardenedDefinitions: AgentToolDefinition[] = DEFINITIONS.map(tool => {
  let schema: Schema = tool.inputSchema;
  if (tool.name === "smart_brush") schema = { ...schema, allOf: [
    { if: { properties: { mode: { const: "area" } } }, then: { ...requiredKeys("region"), not: { anyOf: [requiredKeys("cells"), { ...requiredKeys("erase"), properties: { erase: { const: true } } }] } } },
    { if: { properties: { mode: { const: "road" } } }, then: { ...requiredKeys("cells"), not: requiredKeys("region") } },
  ] };
  if (tool.name === "get_tile_catalog") schema = { ...schema, allOf: [
    { not: { ...requiredKeys("tileIds"), anyOf: [requiredKeys("offset"), requiredKeys("limit")] } },
    { if: requiredKeys("sheetRegion"), then: { ...requiredKeys("image"), properties: { image: { const: "sheet" } } } },
    { not: { ...requiredKeys("tileIds", "image"), properties: { tileIds: {}, image: { const: "sheet" } } } },
  ] };
  if (tool.name === "visual_ingest_reference") schema = {
    ...schema, properties: { ...(schema.properties as Record<string, JsonValue>), selectedReferenceToken: ref("Id") },
    required: ["context"], oneOf: [requiredKeys("pngBase64"), requiredKeys("selectedReferenceToken")],
  };
  return { ...tool, inputSchema: { ...schema, type: "object", $schema: "https://json-schema.org/draft/2020-12/schema" } };
});
function feature(name: AgentToolDefinition["name"], title: string, description: string, schema: Schema, readOnly: boolean): AgentToolDefinition {
  return { name, title, description, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false },
    inputSchema: { ...schema, type: "object", $schema: "https://json-schema.org/draft/2020-12/schema" } };
}
const batchNames = ["paint_cells", "paint_rect", "paint_line", "place_stamp", "place_entity", "edit_entity"] as const;
const batchBranches = batchNames.map(name => {
  const source = name === "edit_entity" ? editEntitySchema : hardenedDefinitions.find(t => t.name === name)!.inputSchema;
  function withoutContext(schema: Schema): Schema {
    if (Array.isArray(schema.oneOf)) return { oneOf: schema.oneOf.map(branch => withoutContext(branch as Schema)) };
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
  feature("apply_operations", "Apply Operations", "Apply 1–32 sequential existing-ID paint_cells/paint_rect/paint_line/place_stamp/place_entity/edit_entity operations with one outer WriteContext, revision and idempotency key. Each item is {tool,args} without context. Stamps require explicit existing layerMapping and cannot create layers. Complete sequential preflight rejects the whole batch before mutation; children consume mutation/memory budgets and aggregate planned cells must be ≤4096. No lifecycle, creation, fill, source preparation or tags. Replay creates no duplicates; approval joins one world undo group.", objectSchema({ context: ref("WriteContext"), operations: { type: "array", minItems: 1, maxItems: 32, items: { oneOf: batchBranches } } }), false),
  feature("validate_goals", "Validate Goals", "Check explicit map goals in bounded regions, separately from validate_map structural checks. reachability uses FOUR orthogonal neighbors and caller-selected collisionLayerIds in map stack order: uppermost nonzero value wins, blockedValues identifies blocked decisions and emptyIsBlocked defines cells with no decision. Never infers terrain or visual walkability. region_unchanged resolves tile identities/orientations, collision and entities; omit expectedDigest to capture a baseline (passed/valid:null), then supply it after edits. Digests bind map/layers/region and survive unrelated palette appends. entity_count uses explicit entity layers, optional existing typeId and inclusive min/max. ≤16 checks, ≤16384 aggregate cell-layer scans plus bounded entities; no writes.", objectSchema({ context: ref("ReadContext"), mapId: ref("Id"), checks: { type: "array", minItems: 1, maxItems: 16, items: goalSchema } }), true),
];
export const TOOL_DEFINITIONS: readonly AgentToolDefinition[] = [...hardenedDefinitions, ...featureDefinitions].map(tool => ({
  ...tool, inputSchema: { ...tool.inputSchema, $defs: reachableSchemaDefinitions(tool.inputSchema, SHARED_DEFS) },
}));

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

/** The root is an MCP tools/list result, directly embeddable by Rust. */
export function generateToolsJson(): string {
  return canonicalJson({ tools: TOOL_DEFINITIONS });
}
