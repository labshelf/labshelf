// Describes one entry of the Typst standard-library catalogue and builds entries tersely.
// Types and defaults are written as Typst source (`auto | length`, `11pt`), as in the Typst reference.

export interface TypstParam {
  name: string;
  type: string;
  positional: boolean;
  default?: string;
  /** Takes any number of arguments, like `children` of `stack`. */
  variadic?: true;
  doc: string;
}

export interface TypstBuiltin {
  name: string;
  kind: "function" | "type" | "module" | "value";
  doc: string;
  /** For a function its parameters; for a type its constructor's. */
  params?: readonly TypstParam[];
  returns?: string;
  members?: readonly TypstBuiltin[];
}

/** A positional parameter; a default makes it optional. */
export function createPositionalParam(name: string, type: string, doc: string, defaultValue?: string): TypstParam {
  return defaultValue === undefined ? { name, type, positional: true, doc } : { name, type, positional: true, default: defaultValue, doc };
}

/** A positional parameter that takes any number of arguments. */
export function createVariadicParam(name: string, type: string, doc: string): TypstParam {
  return { name, type, positional: true, variadic: true, doc };
}

/** A named parameter; the default is omitted only where the reference gives none (a required named argument). */
export function createNamedParam(name: string, type: string, defaultValue: string | undefined, doc: string): TypstParam {
  return defaultValue === undefined ? { name, type, positional: false, doc } : { name, type, positional: false, default: defaultValue, doc };
}

export function createFunctionBuiltin(name: string, doc: string, params: readonly TypstParam[], returns: string, members?: readonly TypstBuiltin[]): TypstBuiltin {
  return members ? { name, kind: "function", doc, params, returns, members } : { name, kind: "function", doc, params, returns };
}

export function createTypeBuiltin(name: string, doc: string, params: readonly TypstParam[] | undefined, members: readonly TypstBuiltin[]): TypstBuiltin {
  return params ? { name, kind: "type", doc, params, members } : { name, kind: "type", doc, members };
}

export function createModuleBuiltin(name: string, doc: string, members?: readonly TypstBuiltin[]): TypstBuiltin {
  return members ? { name, kind: "module", doc, members } : { name, kind: "module", doc };
}

export function createConstantBuiltin(name: string, doc: string): TypstBuiltin {
  return { name, kind: "value", doc };
}
