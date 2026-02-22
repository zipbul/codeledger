export { Gildash } from "./gildash";
export type { GildashOptions, Logger } from "./gildash";

export { gildashError } from "./errors";
export type { GildashError, GildashErrorType } from "./errors";

export { symbolSearch } from "./search/symbol-search";
export type { SymbolSearchQuery, SymbolSearchResult } from "./search/symbol-search";
export { relationSearch } from "./search/relation-search";
export type { RelationSearchQuery } from "./search/relation-search";
export { DependencyGraph } from "./search/dependency-graph";

export type { IndexResult } from "./indexer/index-coordinator";
export type { ProjectBoundary } from "./common/project-discovery";
export type { CodeRelation, SymbolKind } from "./extractor/types";
export type { SymbolStats } from "./store/repositories/symbol.repository";
export type { WatcherRole } from "./watcher/types";
