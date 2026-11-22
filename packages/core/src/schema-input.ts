import type { JSONSchema } from "./contract.js";

type Primitive = string | number | boolean | null;
type RequiredKeys<S> = S extends { readonly required: readonly (infer K extends string)[] } ? K : never;
type Properties<S> = S extends { readonly properties: infer P extends Record<string, JSONSchema> } ? P : {};
type ObjectInput<S, P extends Record<string, JSONSchema> = Properties<S>> =
  { -readonly [K in keyof P as K extends RequiredKeys<S> ? K : never]-?: SchemaInput<P[K]> } &
  { -readonly [K in keyof P as K extends RequiredKeys<S> ? never : K]?: SchemaInput<P[K]> };
type ByType<S, T> =
  T extends "string" ? string :
  T extends "number" | "integer" ? number :
  T extends "boolean" ? boolean :
  T extends "null" ? null :
  T extends "array" ? S extends { readonly items: infer I extends JSONSchema } ? SchemaInput<I>[] : unknown[] :
  T extends "object" ? ObjectInput<S> : unknown;

/** Input types for inline, literal JSON Schemas. Runtime validation is still required.
 * References, negation and schemas without enough type information remain unknown.
 * Numeric/string constraints affect runtime validation, not TypeScript primitives.
 */
export type SchemaInput<S> =
  S extends { readonly const: infer C extends Primitive } ? C :
  S extends { readonly enum: readonly (infer E)[] } ? E :
  S extends { readonly anyOf: readonly (infer A)[] } ? SchemaInput<A> :
  S extends { readonly oneOf: readonly (infer A)[] } ? SchemaInput<A> :
  S extends { readonly type: readonly (infer T)[] } ? ByType<S, T> :
  S extends { readonly type: infer T } ? ByType<S, T> : unknown;
