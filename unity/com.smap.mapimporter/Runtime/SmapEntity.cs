using System.Collections.Generic;
using UnityEngine;

namespace Smap.MapImporter
{
    /// <summary>
    /// An entity placed in the editor (NPC, door, chest, portal…), created by
    /// the importer under the map prefab's "Entities" child. The GameObject
    /// sits at the centre of the entity's box, the way a Tilemap anchors a tile
    /// at its cell centre. Data only: what an entity does is up to game code.
    /// </summary>
    public sealed class SmapEntity : MonoBehaviour
    {
        /// <summary>Entity id, stable and unique in the level.</summary>
        public string id;
        /// <summary>Type name as shown in the editor.</summary>
        public string typeName;
        /// <summary>Stable type id ("spawn" and "portal" are built in).</summary>
        public string typeId;
        public string layerId;
        public string layerName;
        /// <summary>Top-left corner of the box in pixels, editor convention (y down).</summary>
        public Vector2 pixelPosition;
        /// <summary>Editor cell under the top-left corner (y down).</summary>
        public Vector2Int cell;
        /// <summary>Box size in Unity units (pixels / map tile width).</summary>
        public Vector2 size = Vector2.one;
        /// <summary>Gizmo colour: the entity type's colour, or a default.</summary>
        public Color color = new Color(1f, 0.6f, 0.1f);
        /// <summary>The type's fields in definition order.</summary>
        public List<SmapEntityField> fields = new List<SmapEntityField>();

        public bool IsPortal => typeId == SmapEntityTypes.Portal;

        public SmapEntityField GetField(string fieldName) => SmapEntityField.Find(fields, fieldName);

        public bool TryGet(string fieldName, out string value)
        {
            var f = GetField(fieldName);
            if (f != null) return f.TryGet(out value);
            value = null;
            return false;
        }

        public bool TryGet(string fieldName, out float value)
        {
            var f = GetField(fieldName);
            if (f != null) return f.TryGet(out value);
            value = 0f;
            return false;
        }

        public bool TryGet(string fieldName, out int value)
        {
            var f = GetField(fieldName);
            if (f != null) return f.TryGet(out value);
            value = 0;
            return false;
        }

        public bool TryGet(string fieldName, out bool value)
        {
            var f = GetField(fieldName);
            if (f != null) return f.TryGet(out value);
            value = false;
            return false;
        }

        /// <summary>"point" fields, in pixels (y down).</summary>
        public bool TryGet(string fieldName, out Vector2 value)
        {
            var f = GetField(fieldName);
            if (f != null) return f.TryGet(out value);
            value = default;
            return false;
        }

        void OnDrawGizmos()
        {
            var c = color;
            Gizmos.color = new Color(c.r, c.g, c.b, 0.25f);
            Gizmos.DrawCube(transform.position, size);
            Gizmos.color = new Color(c.r, c.g, c.b, 1f);
            Gizmos.DrawWireCube(transform.position, size);
        }
    }
}
