import type { Program } from 'oxc-parser';
import type { TsconfigPaths } from '../common/tsconfig-resolver';
import type { CodeRelation } from './types';
import { buildImportMap, resolveImport } from './extractor-utils';
import { extractImports } from './imports-extractor';
import { extractCalls } from './calls-extractor';
import { extractHeritage } from './heritage-extractor';

export type ResolveImportFn = (
  currentFilePath: string,
  importPath: string,
  tsconfigPaths?: TsconfigPaths,
) => string[];

export function extractRelations(
  ast: Program,
  filePath: string,
  tsconfigPaths?: TsconfigPaths,
  resolveImportFn: ResolveImportFn = resolveImport,
): CodeRelation[] {
  const importMap = buildImportMap(ast, filePath, tsconfigPaths, resolveImportFn);

  const imports = extractImports(ast, filePath, tsconfigPaths, resolveImportFn);
  const calls = extractCalls(ast, filePath, importMap);
  const heritage = extractHeritage(ast, filePath, importMap);

  return [...imports, ...calls, ...heritage];
}
