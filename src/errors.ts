export class CodeLedgerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CodeLedgerError";
  }
}

export class WatcherError extends CodeLedgerError {
  name = "WatcherError";
}

export class ParseError extends CodeLedgerError {
  name = "ParseError";
}

export class ExtractError extends CodeLedgerError {
  name = "ExtractError";
}

export class IndexError extends CodeLedgerError {
  name = "IndexError";
}

export class StoreError extends CodeLedgerError {
  name = "StoreError";
}

export class SearchError extends CodeLedgerError {
  name = "SearchError";
}