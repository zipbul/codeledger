/**
 * Global test setup — loaded via bunfig.toml [test] preload.
 *
 * Captures real module references before any spec file can mock them,
 * then restores those references in a global afterEach so that
 * mock.module() calls in one spec file do not leak into the next.
 *
 * Why afterEach + mock.module(real)?
 *   - mock.restore() does NOT undo mock.module() (bun official docs).
 *   - mock.module() updates ESM live bindings, so re-calling it with
 *     the real exports effectively "un-mocks" the module for subsequent tests.
 *
 * IMPORTANT: `import * as ns` returns a live-binding namespace object.
 *   When mock.module() replaces the module, the namespace is ALSO updated.
 *   Therefore we must spread the namespace into a plain object to snapshot
 *   the real exports BEFORE any mocking occurs.
 */
import { afterEach, mock } from 'bun:test';

// ── Capture real modules (snapshot via spread, before any mock.module) ──
import * as realAstUtils from '../src/parser/ast-utils';
import * as realSourcePosition from '../src/parser/source-position';
import * as realJsdocParser from '../src/parser/jsdoc-parser';
import * as realExtractorUtils from '../src/extractor/extractor-utils';
import * as realImportsExtractor from '../src/extractor/imports-extractor';
import * as realCallsExtractor from '../src/extractor/calls-extractor';
import * as realHeritageExtractor from '../src/extractor/heritage-extractor';
import * as realSymbolExtractor from '../src/extractor/symbol-extractor';
import * as realRelationExtractor from '../src/extractor/relation-extractor';
import * as realHasher from '../src/common/hasher';
import * as realPathUtils from '../src/common/path-utils';
import * as realTsconfigResolver from '../src/common/tsconfig-resolver';
import * as realProjectDiscovery from '../src/common/project-discovery';
import * as realFileIndexer from '../src/indexer/file-indexer';
import * as realSymbolIndexer from '../src/indexer/symbol-indexer';
import * as realRelationIndexer from '../src/indexer/relation-indexer';
import * as realIndexCoordinator from '../src/indexer/index-coordinator';
import * as realDependencyGraph from '../src/search/dependency-graph';
import * as realCommentParser from 'comment-parser';
import * as realNodePath from 'node:path';
import * as realNodeFs from 'node:fs';
import * as realAstGrepNapi from '@ast-grep/napi';
import * as realDrizzleBunSqlite from 'drizzle-orm/bun-sqlite';
import * as realDrizzleMigrator from 'drizzle-orm/bun-sqlite/migrator';
import * as realBunSqlite from 'bun:sqlite';

const origAstUtils = { ...realAstUtils };
const origSourcePosition = { ...realSourcePosition };
const origJsdocParser = { ...realJsdocParser };
const origExtractorUtils = { ...realExtractorUtils };
const origImportsExtractor = { ...realImportsExtractor };
const origCallsExtractor = { ...realCallsExtractor };
const origHeritageExtractor = { ...realHeritageExtractor };
const origSymbolExtractor = { ...realSymbolExtractor };
const origRelationExtractor = { ...realRelationExtractor };
const origHasher = { ...realHasher };
const origPathUtils = { ...realPathUtils };
const origTsconfigResolver = { ...realTsconfigResolver };
const origProjectDiscovery = { ...realProjectDiscovery };
const origFileIndexer = { ...realFileIndexer };
const origSymbolIndexer = { ...realSymbolIndexer };
const origRelationIndexer = { ...realRelationIndexer };
const origIndexCoordinator = { ...realIndexCoordinator };
const origDependencyGraph = { ...realDependencyGraph };
const origCommentParser = { ...realCommentParser };
const origNodePath = { ...realNodePath };
const origNodeFs = { ...realNodeFs };
const origAstGrepNapi = { ...realAstGrepNapi };
const origDrizzleBunSqlite = { ...realDrizzleBunSqlite };
const origDrizzleMigrator = { ...realDrizzleMigrator };
const origBunSqlite = { ...realBunSqlite };

// ── Global cleanup after every test ──
afterEach(() => {
  // Restore real module implementations via live binding updates.
  mock.module('../src/parser/ast-utils', () => origAstUtils);
  mock.module('../src/parser/source-position', () => origSourcePosition);
  mock.module('../src/parser/jsdoc-parser', () => origJsdocParser);
  mock.module('../src/extractor/extractor-utils', () => origExtractorUtils);
  mock.module('../src/extractor/imports-extractor', () => origImportsExtractor);
  mock.module('../src/extractor/calls-extractor', () => origCallsExtractor);
  mock.module('../src/extractor/heritage-extractor', () => origHeritageExtractor);
  mock.module('../src/extractor/symbol-extractor', () => origSymbolExtractor);
  mock.module('../src/extractor/relation-extractor', () => origRelationExtractor);
  mock.module('../src/common/hasher', () => origHasher);
  mock.module('../src/common/path-utils', () => origPathUtils);
  mock.module('../src/common/tsconfig-resolver', () => origTsconfigResolver);
  mock.module('../src/common/project-discovery', () => origProjectDiscovery);
  mock.module('../src/indexer/file-indexer', () => origFileIndexer);
  mock.module('../src/indexer/symbol-indexer', () => origSymbolIndexer);
  mock.module('../src/indexer/relation-indexer', () => origRelationIndexer);
  mock.module('../src/indexer/index-coordinator', () => origIndexCoordinator);
  mock.module('../src/search/dependency-graph', () => origDependencyGraph);
  mock.module('comment-parser', () => origCommentParser);
  mock.module('node:path', () => origNodePath);
  mock.module('node:fs', () => origNodeFs);
  mock.module('@ast-grep/napi', () => origAstGrepNapi);
  mock.module('drizzle-orm/bun-sqlite', () => origDrizzleBunSqlite);
  mock.module('drizzle-orm/bun-sqlite/migrator', () => origDrizzleMigrator);
  mock.module('bun:sqlite', () => origBunSqlite);

  // Restore spy implementations + clear call history.
  mock.restore();
});
