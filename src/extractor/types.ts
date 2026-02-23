import type { SourcePosition, SourceSpan } from '../parser/types';

/**
 * The kind of a symbol extracted from TypeScript source.
 *
 * - `'function'` — standalone function declarations and expressions
 * - `'method'` — class methods, getters, setters, and constructors
 * - `'class'` — class declarations
 * - `'variable'` — `const`, `let`, `var` declarations
 * - `'type'` — type alias declarations
 * - `'interface'` — interface declarations
 * - `'enum'` — enum declarations
 * - `'property'` — class properties and interface/type members
 */
export type SymbolKind =
  | 'function'
  | 'method'
  | 'class'
  | 'variable'
  | 'type'
  | 'interface'
  | 'enum'
  | 'property';

/**
 * TypeScript declaration modifiers attached to a symbol.
 */
export type Modifier =
  | 'async'
  | 'static'
  | 'abstract'
  | 'readonly'
  | 'private'
  | 'protected'
  | 'public'
  | 'override'
  | 'declare'
  | 'const';

/**
 * A function/method parameter.
 */
export interface Parameter {
  /** Parameter name. */
  name: string;
  /** Type annotation as raw source text, e.g. `"string"`, `"number[]"`. */
  type?: string;
  /** Whether the parameter is optional (has `?` or a default value). */
  isOptional: boolean;
  /** Default value expression as source text. */
  defaultValue?: string;
  /** Decorators applied to this parameter (e.g. `@Inject`, `@Body`). */
  decorators?: Decorator[];
}

/**
 * A class/interface heritage clause (`extends` or `implements`).
 */
export interface Heritage {
  /** Whether this is an `extends` or `implements` clause. */
  kind: 'extends' | 'implements';
  /** Name of the base class or implemented interface. */
  name: string;
  /** Generic type arguments, e.g. `['T', 'U']`. */
  typeArguments?: string[];
}

/**
 * A decorator applied to a class, method, property, or parameter.
 */
export interface Decorator {
  /** Decorator name without `@`. */
  name: string;
  /** Decorator call arguments as source text. */
  arguments?: string[];
}

/**
 * A single JSDoc tag parsed from a documentation comment.
 *
 * @example
 * For `@param name - The user's name`:
 * ```ts
 * { tag: 'param', name: 'name', type: '', description: "The user's name", optional: false }
 * ```
 */
export interface JsDocTag {
  /** Tag name without `@` (e.g. `'param'`, `'returns'`, `'deprecated'`). */
  tag: string;
  /** First word after the tag, typically a parameter name for `@param`. */
  name: string;
  /** Type in curly braces (e.g. `'{string}'` → `'string'`). Empty if absent. */
  type: string;
  /** Description text following the name. */
  description: string;
  /** `true` if the name is wrapped in `[brackets]` (optional parameter). */
  optional: boolean;
  /** Default value if `[name=default]` syntax is used. */
  default?: string;
}

/**
 * A parsed JSDoc documentation comment block.
 */
export interface JsDocBlock {
  /** Full description text before any tags. */
  description: string;
  /** Parsed `@tag` entries. */
  tags: JsDocTag[];
}

/**
 * A symbol extracted from a TypeScript source file.
 *
 * Represents a single named declaration (function, class, variable, type, etc.)
 * with its location, metadata, and optional nested members.
 */
export interface ExtractedSymbol {
  /** What kind of symbol this is. */
  kind: SymbolKind;
  /** Symbol name (e.g. `'MyClass'`, `'handleClick'`). */
  name: string;
  /** Source location (start/end line and column). */
  span: SourceSpan;
  /** Whether this symbol is exported from its module. */
  isExported: boolean;
  /** For methods: distinguishes `'method'`, `'getter'`, `'setter'`, or `'constructor'`. */
  methodKind?: 'method' | 'getter' | 'setter' | 'constructor';

  /** Function/method parameters. Present for functions, methods, and constructors. */
  parameters?: Parameter[];
  /** Return type annotation as source text. */
  returnType?: string;
  /** Generic type parameter names (e.g. `['T', 'U extends Foo']`). */
  typeParameters?: string[];
  /** Declaration modifiers (e.g. `async`, `static`, `readonly`). */
  modifiers: Modifier[];
  /** Heritage clauses (`extends` / `implements`). Present for classes and interfaces. */
  heritage?: Heritage[];
  /** Decorators applied to this symbol. */
  decorators?: Decorator[];
  /** Nested members (class fields, methods, interface properties, enum members). */
  members?: ExtractedSymbol[];
  /** Parsed JSDoc comment associated with this symbol. */
  jsDoc?: JsDocBlock;
}

/**
 * A dot-separated qualified name (e.g. `a.b.c`).
 */
export interface QualifiedName {
  /** Leftmost identifier (e.g. `'a'` in `'a.b.c'`). */
  root: string;
  /** Subsequent parts (e.g. `['b', 'c']`). */
  parts: string[];
  /** Full joined string (e.g. `'a.b.c'`). */
  full: string;
}

/**
 * An import reference resolved from an import statement.
 */
export interface ImportReference {
  /** Resolved absolute path of the imported module. */
  path: string;
  /** The imported name: `'default'` for default imports, `'*'` for namespace, or the named identifier. */
  importedName: string;
}

/**
 * A relationship between two symbols/files extracted from source code.
 *
 * - `'imports'` — file A imports from file B
 * - `'type-references'` — file A type-only imports from file B (`import type`)
 * - `'re-exports'` — file A re-exports from file B (`export { ... } from`)
 * - `'calls'` — symbol in file A calls a symbol in file B
 * - `'extends'` — class/interface in file A extends one in file B
 * - `'implements'` — class in file A implements an interface in file B
 */
export interface CodeRelation {
  /** The kind of relationship. */
  type: 'imports' | 'type-references' | 're-exports' | 'calls' | 'extends' | 'implements';
  /** File path where the relationship originates. */
  srcFilePath: string;
  /** Source symbol name, or `null` for module-level relationships. */
  srcSymbolName: string | null;
  /** File path of the target. */
  dstFilePath: string;
  /** Target symbol name, or `null` for module-level imports. */
  dstSymbolName: string | null;
  /** Optional JSON-encoded metadata about the relation. */
  metaJson?: string;
}

export type { SourcePosition, SourceSpan };
