/**
 * Types for the gildash Semantic Layer (tsc-based).
 *
 * All types in this file are plain data shapes — no runtime logic.
 * The Semantic Layer is opt-in via `Gildash.open({ semantic: true })`.
 */

/**
 * The resolved type of a TypeScript symbol, as determined by the tsc TypeChecker.
 *
 * Captures the full structural description of a type including union/intersection
 * decomposition and generic argument resolution.
 */
export interface ResolvedType {
  /** Human-readable type string, e.g. `"string | undefined"`, `"Promise<number>"`. */
  text: string;
  /** Raw TypeScript `TypeFlags` bitmask. */
  flags: number;
  /** Whether this type is a union type (`A | B`). */
  isUnion: boolean;
  /** Whether this type is an intersection type (`A & B`). */
  isIntersection: boolean;
  /**
   * Whether this type contains unresolved generic type parameters.
   * `false` when all type arguments have been concretely resolved.
   */
  isGeneric: boolean;
  /**
   * Constituent types for union or intersection.
   * Populated only when `isUnion` or `isIntersection` is `true`.
   */
  members?: ResolvedType[];
  /**
   * Resolved type arguments for generic instantiations.
   * e.g. `Promise<string>` → `[{ text: "string", ... }]`
   */
  typeArguments?: ResolvedType[];
}

/**
 * A single reference to a symbol, resolved via `LanguageService.findReferences`.
 *
 * Unlike text-based search, semantic references are based on symbol identity —
 * renames, re-exports, and shadowed names are handled correctly.
 */
export interface SemanticReference {
  /** Absolute path of the file containing the reference. */
  filePath: string;
  /** Zero-based character offset within the file. */
  position: number;
  /** One-based line number. */
  line: number;
  /** Zero-based column offset. */
  column: number;
  /** Whether this reference is the symbol's own declaration site. */
  isDefinition: boolean;
  /** Whether this reference is a write (assignment) rather than a read. */
  isWrite: boolean;
}

/**
 * A concrete implementation of an interface or abstract class,
 * found via `LanguageService.getImplementationAtPosition` and
 * `TypeChecker.isTypeAssignableTo`.
 *
 * Includes both explicit (`implements` keyword) and structural (duck-typing) implementations.
 */
export interface Implementation {
  /** Absolute path of the file containing the implementation. */
  filePath: string;
  /** Name of the implementing symbol (class, function, or object literal). */
  symbolName: string;
  /** Zero-based character offset within the file. */
  position: number;
  /** Syntactic kind of the implementing construct. */
  kind: 'class' | 'function' | 'object';
  /** `true` if the `implements` keyword is explicitly present; `false` for duck-typing matches. */
  isExplicit: boolean;
}

/**
 * The semantic view of a module's public interface — exports augmented with resolved types.
 *
 * The syntax-layer extractor already captures export names and kinds.
 * This type adds tsc-resolved type information for each export.
 */
export interface SemanticModuleInterface {
  /** Absolute path of the module file. */
  filePath: string;
  /** Per-export type information. */
  exports: SemanticExport[];
}

/**
 * A single export entry within a {@link SemanticModuleInterface}.
 */
export interface SemanticExport {
  /** Export name as it appears in the source. */
  name: string;
  /** Syntactic kind of the exported symbol. */
  kind: string;
  /**
   * Resolved type of this export, or `null` if type resolution failed.
   * `null` does not propagate as an error — the syntax-layer data remains intact.
   */
  resolvedType: ResolvedType | null;
}
