using UnityEngine;

namespace Smap.MapImporter
{
    /// <summary>
    /// The player's start point from the editor, on the map prefab's "Spawn"
    /// child, at the centre of the spawn box. Find it with
    /// <c>Object.FindFirstObjectByType&lt;SmapSpawn&gt;()</c>.
    /// </summary>
    public sealed class SmapSpawn : MonoBehaviour
    {
        /// <summary>Top-left corner of the spawn box in pixels, editor convention (y down).</summary>
        public Vector2 pixelPosition;
        /// <summary>Editor cell of the spawn (y down).</summary>
        public Vector2Int cell;

        void OnDrawGizmos()
        {
            // A small flag: pole, pennant and a ring at its foot.
            var p = transform.position;
            Gizmos.color = new Color(0.13f, 0.77f, 0.37f);
            Gizmos.DrawWireSphere(p, 0.2f);
            var top = p + new Vector3(0f, 0.6f, 0f);
            Gizmos.DrawLine(p, top);
            Gizmos.DrawLine(top, top + new Vector3(0.3f, -0.1f, 0f));
            Gizmos.DrawLine(top + new Vector3(0.3f, -0.1f, 0f), top + new Vector3(0f, -0.2f, 0f));
        }
    }
}
