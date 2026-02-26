/**
 * Discriminated union type representing all possible error categories in Gildash.
 */
export type GildashErrorType =
  | 'watcher'
  | 'parse'
  | 'extract'
  | 'index'
  | 'store'
  | 'search'
  | 'closed'
  | 'validation'
  | 'close'
  | 'semantic';

/**
 * Error class used throughout Gildash.
 * Extends `Error` so that `instanceof Error` checks work and stack traces are captured.
 */
export class GildashError extends Error {
  constructor(
    public readonly type: GildashErrorType,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'GildashError';
  }
}

/**
 * Factory function that creates a {@link GildashError} value.
 *
 * @param type    - One of the {@link GildashErrorType} variants.
 * @param message - Human-readable description of the error.
 * @param cause   - Optional root cause (any value). When `undefined`, the `cause`
 *                  property is omitted from the returned object entirely.
 * @deprecated Use `new GildashError(type, message, { cause })` instead.
 */
export function gildashError(type: GildashErrorType, message: string, cause?: unknown): GildashError {
  return new GildashError(type, message, cause !== undefined ? { cause } : undefined);
}

