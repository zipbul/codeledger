export { Gildash } from "./gildash";
export type { GildashOptions, Logger } from "./gildash";

export {
  GildashError,
  WatcherError,
  ParseError,
  ExtractError,
  IndexError,
  StoreError,
  SearchError,
} from "./errors";

export { symbolSearch } from "./search/symbol-search";
export type { SymbolSearchQuery, SymbolSearchResult } from "./search/symbol-search";
export { relationSearch } from "./search/relation-search";
export type { RelationSearchQuery } from "./search/relation-search";
export { DependencyGraph } from "./search/dependency-graph";
