/**
 * A small, strict-enough XML reader for Tiled's TMX / TSX files (no DOM in
 * core). Elements, attributes, text, comments, CDATA, the XML declaration and
 * the five predefined entities plus numeric references. No DTDs, no
 * namespaces (prefixes stay part of the name).
 */

export interface XmlElement {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: XmlElement[];
  /** Concatenated character data directly inside this element. */
  text: string;
}

export class XmlParseError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`XML: ${message} (at ${offset})`);
    this.name = "XmlParseError";
  }
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text: string, offset: number): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith("#")) return String.fromCodePoint(parseInt(body.slice(1), 10));
    const value = ENTITIES[body];
    if (value === undefined) throw new XmlParseError(`unknown entity ${whole}`, offset);
    return value;
  });
}

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
const SPACE = /\s*/y;

/** Parses `text` and returns its root element. Throws {@link XmlParseError}. */
export function parseXml(text: string): XmlElement {
  let i = 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  const skipSpace = () => { SPACE.lastIndex = i; SPACE.exec(text); i = SPACE.lastIndex; };
  const readName = (): string => {
    NAME.lastIndex = i;
    const m = NAME.exec(text);
    if (!m) throw new XmlParseError("expected a name", i);
    i = NAME.lastIndex;
    return m[0];
  };
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    const chunk = lt < 0 ? text.slice(i) : text.slice(i, lt);
    if (chunk.length > 0) {
      const top = stack.at(-1);
      if (top) top.text += decodeEntities(chunk, i);
      else if (chunk.trim()) throw new XmlParseError("text outside the root element", i);
    }
    if (lt < 0) break;
    i = lt;
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end < 0) throw new XmlParseError("unterminated comment", i);
      i = end + 3;
    } else if (text.startsWith("<![CDATA[", i)) {
      const end = text.indexOf("]]>", i + 9);
      if (end < 0) throw new XmlParseError("unterminated CDATA", i);
      const top = stack.at(-1);
      if (!top) throw new XmlParseError("CDATA outside the root element", i);
      top.text += text.slice(i + 9, end);
      i = end + 3;
    } else if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i + 2);
      if (end < 0) throw new XmlParseError("unterminated declaration", i);
      i = end + 2;
    } else if (text.startsWith("<!", i)) {
      throw new XmlParseError("DTDs are not supported", i);
    } else if (text.startsWith("</", i)) {
      i += 2;
      const name = readName();
      skipSpace();
      if (text[i] !== ">") throw new XmlParseError("expected >", i);
      i++;
      const open = stack.pop();
      if (!open || open.name !== name) throw new XmlParseError(`unexpected </${name}>`, i);
    } else {
      i++;
      const name = readName();
      const attrs: Record<string, string> = {};
      for (;;) {
        skipSpace();
        const c = text[i];
        if (c === ">" || c === "/") break;
        if (c === undefined) throw new XmlParseError("unterminated tag", i);
        const key = readName();
        skipSpace();
        if (text[i] !== "=") throw new XmlParseError("expected =", i);
        i++;
        skipSpace();
        const quote = text[i];
        if (quote !== '"' && quote !== "'") throw new XmlParseError("expected a quoted value", i);
        const end = text.indexOf(quote, i + 1);
        if (end < 0) throw new XmlParseError("unterminated attribute", i);
        if (Object.hasOwn(attrs, key)) throw new XmlParseError(`duplicate attribute ${key}`, i);
        attrs[key] = decodeEntities(text.slice(i + 1, end), i);
        i = end + 1;
      }
      const element: XmlElement = { name, attrs, children: [], text: "" };
      const parent = stack.at(-1);
      if (parent) parent.children.push(element);
      else if (root) throw new XmlParseError("more than one root element", i);
      else root = element;
      if (text[i] === "/") {
        i++;
        if (text[i] !== ">") throw new XmlParseError("expected />", i);
        i++;
      } else {
        i++;
        stack.push(element);
      }
    }
  }
  if (stack.length > 0) throw new XmlParseError(`unclosed <${stack.at(-1)!.name}>`, text.length);
  if (!root) throw new XmlParseError("no root element", 0);
  return root;
}
