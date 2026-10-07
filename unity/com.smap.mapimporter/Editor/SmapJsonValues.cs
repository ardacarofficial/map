using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using UnityEngine;

namespace Smap.MapImporter
{
    /// <summary>
    /// Reads the two parts of the export that <see cref="JsonUtility"/> cannot:
    /// entity field <c>value</c>s (string, number, bool, null or {x, y} under one
    /// key) and whether top-level <c>spawn</c> is <c>null</c> (JsonUtility turns
    /// null into a zeroed object). Every other top-level key is skipped without
    /// building values. Not a general JSON library.
    /// </summary>
    static class SmapJsonValues
    {
        /// <summary>Raw field values by [entity layer][item][field]; points become <see cref="Vector2"/>.</summary>
        public sealed class Result
        {
            public List<List<List<object>>> fieldValues = new List<List<List<object>>>();
            /// <summary>False when the file has no "spawn" key or it is null.</summary>
            public bool hasSpawn;
        }

        public static Result Read(string json)
        {
            var reader = new Reader(json);
            var result = new Result();
            reader.Ws();
            reader.Expect('{');
            reader.Ws();
            if (reader.Peek() == '}') return result;
            while (true)
            {
                reader.Ws();
                string key = reader.String();
                reader.Ws();
                reader.Expect(':');
                reader.Ws();
                if (key == "entities") ReadEntities(reader.Value(true), result);
                else if (key == "spawn") result.hasSpawn = reader.Value(true) is Dictionary<string, object>;
                else reader.Value(false);
                reader.Ws();
                if (reader.Peek() == ',') { reader.Next(); continue; }
                reader.Expect('}');
                return result;
            }
        }

        static void ReadEntities(object entities, Result result)
        {
            if (!(entities is List<object> layers)) return;
            foreach (var layer in layers)
            {
                var itemValues = new List<List<object>>();
                result.fieldValues.Add(itemValues);
                if (!(layer is Dictionary<string, object> l) || !l.TryGetValue("items", out var items) || !(items is List<object> itemList)) continue;
                foreach (var item in itemList)
                {
                    var values = new List<object>();
                    itemValues.Add(values);
                    if (!(item is Dictionary<string, object> it) || !it.TryGetValue("fields", out var fields) || !(fields is List<object> fieldList)) continue;
                    foreach (var field in fieldList)
                    {
                        object value = null;
                        if (field is Dictionary<string, object> f && f.TryGetValue("value", out var v))
                        {
                            value = v;
                            if (v is Dictionary<string, object> obj)
                                value = obj.TryGetValue("x", out var x) && obj.TryGetValue("y", out var y) && x is double dx && y is double dy
                                    ? new Vector2((float)dx, (float)dy)
                                    : null;
                        }
                        values.Add(value);
                    }
                }
            }
        }

        sealed class Reader
        {
            readonly string s;
            int i;

            public Reader(string text) { s = text; }

            public char Peek() => i < s.Length ? s[i] : '\0';
            public char Next() => i < s.Length ? s[i++] : throw Error("unexpected end");
            ArgumentException Error(string what) => new ArgumentException($"JSON: {what} at offset {i}");

            public void Ws()
            {
                while (i < s.Length && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++;
            }

            public void Expect(char c)
            {
                if (Next() != c) { i--; throw Error($"expected '{c}'"); }
            }

            /// <summary>Parses (build) or skips one value: Dictionary, List, string, double, bool or null.</summary>
            public object Value(bool build)
            {
                char c = Peek();
                switch (c)
                {
                    case '{':
                    {
                        Next();
                        var obj = build ? new Dictionary<string, object>() : null;
                        Ws();
                        if (Peek() == '}') { Next(); return obj; }
                        while (true)
                        {
                            Ws();
                            string key = String();
                            Ws();
                            Expect(':');
                            Ws();
                            var v = Value(build);
                            if (build) obj[key] = v;
                            Ws();
                            if (Next() == '}') return obj;
                            i--;
                            Expect(',');
                        }
                    }
                    case '[':
                    {
                        Next();
                        var list = build ? new List<object>() : null;
                        Ws();
                        if (Peek() == ']') { Next(); return list; }
                        while (true)
                        {
                            Ws();
                            var v = Value(build);
                            if (build) list.Add(v);
                            Ws();
                            if (Next() == ']') return list;
                            i--;
                            Expect(',');
                        }
                    }
                    case '"':
                        return String();
                    case 't': Literal("true"); return true;
                    case 'f': Literal("false"); return false;
                    case 'n': Literal("null"); return null;
                    default:
                    {
                        int start = i;
                        while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
                        if (start == i) throw Error("unexpected character");
                        if (!build) return null;
                        if (!double.TryParse(s.Substring(start, i - start), NumberStyles.Float, CultureInfo.InvariantCulture, out var d)) throw Error("bad number");
                        return d;
                    }
                }
            }

            void Literal(string word)
            {
                if (string.CompareOrdinal(s, i, word, 0, word.Length) != 0) throw Error($"expected {word}");
                i += word.Length;
            }

            public string String()
            {
                Expect('"');
                StringBuilder sb = null;
                int start = i;
                while (true)
                {
                    char c = Next();
                    if (c == '"') return sb == null ? s.Substring(start, i - 1 - start) : sb.ToString();
                    if (c != '\\') { sb?.Append(c); continue; }
                    if (sb == null) sb = new StringBuilder().Append(s, start, i - 1 - start);
                    char e = Next();
                    switch (e)
                    {
                        case 'n': sb.Append('\n'); break;
                        case 't': sb.Append('\t'); break;
                        case 'r': sb.Append('\r'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'u':
                            if (i + 4 > s.Length) throw Error("bad escape");
                            sb.Append((char)int.Parse(s.Substring(i, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                            i += 4;
                            break;
                        default: sb.Append(e); break; // \" \\ \/
                    }
                }
            }
        }
    }
}
