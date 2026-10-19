import type { MessageKey } from "./messages.generated";
export type { MessageKey } from "./messages.generated";

/** Nested shape retained for consumers of the old type facade. */
export type Messages = {
  readonly [S in MessageKey extends `${infer Section}.${string}` ? Section : never]: {
    readonly [K in MessageKey as K extends `${S}.${infer Name}` ? Name : never]: string;
  };
};
export type MessageParams = Readonly<Record<string, string | number>>;
