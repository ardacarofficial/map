import type { tr } from "./tr";

type Widen<T> = { readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };

/** Shape every language file must match (keys of `tr.ts`, any string values). */
export type Messages = Widen<typeof tr>;

type Section = keyof Messages & string;

/** `"section.key"` — every translatable string. */
export type MessageKey = {
  [S in Section]: `${S}.${keyof Messages[S] & string}`;
}[Section];

export type MessageParams = Readonly<Record<string, string | number>>;
