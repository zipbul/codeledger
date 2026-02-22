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
  | 'close';

/**
 * Plain-object error value used throughout Gildash's Result-based error handling.
 * Produced by {@link gildashError} and carried as the `data` field of an `Err<GildashError>`.
 */
export interface GildashError {
  type: GildashErrorType;
  message: string;
  cause?: unknown;
}

/**
 * Factory function that creates a {@link GildashError} value.
 *
 * @param type    - One of the {@link GildashErrorType} variants.
 * @param message - Human-readable description of the error.
 * @param cause   - Optional root cause (any value). When `undefined`, the `cause`
 *                  property is omitted from the returned object entirely.
 */
export function gildashError(type: GildashErrorType, message: string, cause?: unknown): GildashError {
  return cause !== undefined
    ? { type, message, cause }
    : { type, message };
}

