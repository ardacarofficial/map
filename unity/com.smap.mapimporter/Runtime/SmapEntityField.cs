using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;

namespace Smap.MapImporter
{
    /// <summary>Ids of the editor's built-in entity types and the portal's fields.</summary>
    public static class SmapEntityTypes
    {
        /// <summary>The player's start; also exported as the top-level spawn.</summary>
        public const string Spawn = "spawn";
        /// <summary>v1.1 portal marker: an editor marker only, no teleport logic.</summary>
        public const string Portal = "portal";
        /// <summary>Portal field: target level id ("levelRef").</summary>
        public const string PortalTargetLevel = "targetLevel";
        /// <summary>Portal field: target point in the target level, pixels, y down ("point").</summary>
        public const string PortalTargetPoint = "targetPoint";
    }

    /// <summary>
    /// One field of an exported entity (the entity type's fields are defined in
    /// the editor). The importer fills the member that matches <see cref="type"/>;
    /// <see cref="stringValue"/> always holds a text form of the value.
    /// </summary>
    [Serializable]
    public sealed class SmapEntityField
    {
        /// <summary>Field name, unique within the entity type.</summary>
        public string name;
        /// <summary>"string", "int", "float", "bool", "enum", "levelRef" or "point".</summary>
        public string type;
        /// <summary>False when the value is unset (only "levelRef" and "point" can be).</summary>
        public bool hasValue;
        /// <summary>
        /// The value as text: string/enum as is, levelRef = target level id,
        /// int/float in invariant culture, bool "true"/"false", point "x,y"; "" when unset.
        /// </summary>
        public string stringValue = "";
        /// <summary>"int" and "float" fields.</summary>
        public double number;
        /// <summary>"bool" fields.</summary>
        public bool boolValue;
        /// <summary>"point" fields: pixels in the editor's convention (y down, origin top-left of the level it refers to).</summary>
        public Vector2 point;

        public bool IsNumber => type == "int" || type == "float";

        /// <summary>The field called <paramref name="name"/>, or null.</summary>
        public static SmapEntityField Find(IList<SmapEntityField> fields, string name)
        {
            if (fields == null) return null;
            for (int i = 0; i < fields.Count; i++)
                if (fields[i] != null && fields[i].name == name) return fields[i];
            return null;
        }

        /// <summary>
        /// Builds a field from its exported JSON value: null, string, double,
        /// bool, or a point given as (x, y). Values that do not fit the type are left unset.
        /// </summary>
        public static SmapEntityField FromValue(string name, string type, object value)
        {
            var f = new SmapEntityField { name = name, type = type };
            if (!Fits(type, value)) return f;
            switch (value)
            {
                case string s:
                    f.hasValue = true;
                    f.stringValue = s;
                    break;
                case double d:
                    f.hasValue = true;
                    f.number = d;
                    f.stringValue = d.ToString("R", CultureInfo.InvariantCulture);
                    break;
                case bool b:
                    f.hasValue = true;
                    f.boolValue = b;
                    f.stringValue = b ? "true" : "false";
                    break;
                case Vector2 p:
                    f.hasValue = true;
                    f.point = p;
                    f.stringValue = p.x.ToString(CultureInfo.InvariantCulture) + "," + p.y.ToString(CultureInfo.InvariantCulture);
                    break;
            }
            return f;
        }

        /// <summary>
        /// Whether a JSON value can be the value of a field of this type. A hand-edited
        /// "int" field holding "abc" must stay unset, not read as 0. Unknown (newer) types accept anything.
        /// </summary>
        static bool Fits(string type, object value)
        {
            switch (type)
            {
                case "string":
                case "enum":
                case "levelRef":
                    return value is string;
                case "int":
                case "float":
                    return value is double;
                case "bool":
                    return value is bool;
                case "point":
                    return value is Vector2;
                default:
                    return true;
            }
        }

        public bool TryGet(out string value)
        {
            value = hasValue ? stringValue : null;
            return hasValue;
        }

        public bool TryGet(out float value)
        {
            value = hasValue && IsNumber ? (float)number : 0f;
            return hasValue && IsNumber;
        }

        /// <summary>True for "int" fields, and for "float" fields holding a whole number in range.</summary>
        public bool TryGet(out int value)
        {
            bool ok = hasValue && IsNumber && number == Math.Floor(number) && number >= int.MinValue && number <= int.MaxValue;
            value = ok ? (int)number : 0;
            return ok;
        }

        public bool TryGet(out bool value)
        {
            bool ok = hasValue && type == "bool";
            value = ok && boolValue;
            return ok;
        }

        /// <summary>"point" fields, in pixels (y down).</summary>
        public bool TryGet(out Vector2 value)
        {
            bool ok = hasValue && type == "point";
            value = ok ? point : default;
            return ok;
        }
    }
}
