/**
 * Base error class for all Gildash errors.
 * Every error thrown by this library is an instance of `GildashError`.
 *
 * @example
 * ```ts
 * try {
 *   await Gildash.open({ projectRoot: '/path' });
 * } catch (err) {
 *   if (err instanceof GildashError) {
 *     console.error('Gildash error:', err.message);
 *   }
 * }
 * ```
 */
export class GildashError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GildashError";
  }
}

/** Thrown when the file watcher fails to start or stop. */
export class WatcherError extends GildashError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WatcherError";
  }
}

/** Thrown when AST parsing of a TypeScript file fails. */
export class ParseError extends GildashError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ParseError";
  }
}

/** Thrown when symbol or relation extraction from a parsed AST fails. */
export class ExtractError extends GildashError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ExtractError";
  }
}

/** Thrown when the indexing pipeline encounters an unrecoverable error. */
export class IndexError extends GildashError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "IndexError";
  }
}

/** Thrown when a database (SQLite) operation fails. */
export class StoreError extends GildashError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StoreError";
  }
}

/** Thrown when a search query (symbol search, relation search) fails. */
export class SearchError extends GildashError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SearchError";
  }
}
