import type { Program } from 'oxc-parser';
import type { TsconfigPaths } from '../common/tsconfig-resolver';
import type { CodeRelation } from './types';
import { resolveImport } from './extractor-utils';
import { visit, getStringLiteralValue } from '../parser/ast-utils';

export function extractImports(
  ast: Program,
  filePath: string,
  tsconfigPaths?: TsconfigPaths,
  resolveImportFn: (
    currentFilePath: string,
    importPath: string,
    tsconfigPaths?: TsconfigPaths,
  ) => string[] = resolveImport,
): CodeRelation[] {
  const relations: CodeRelation[] = [];
  const body = (ast as unknown as { body?: Array<Record<string, unknown>> }).body ?? [];

  for (const node of body) {
    if (node.type === 'ImportDeclaration') {
      const sourcePath: string = ((node.source as { value?: string } | undefined)?.value) ?? '';
      const candidates = resolveImportFn(filePath, sourcePath, tsconfigPaths);
      if (candidates.length === 0) continue;
      const resolved = candidates[0]!;

      const isType = node.importKind === 'type';
      const specifiers = (node.specifiers as Array<Record<string, unknown>> | undefined) ?? [];

      if (specifiers.length === 0) {
        // side-effect import: import './foo'
        const meta: Record<string, unknown> = {};
        if (isType) meta.isType = true;
        relations.push({
          type: isType ? 'type-references' : 'imports',
          srcFilePath: filePath,
          srcSymbolName: null,
          dstFilePath: resolved,
          dstSymbolName: null,
          ...(Object.keys(meta).length > 0 ? { metaJson: JSON.stringify(meta) } : {}),
        });
      } else {
        for (const spec of specifiers) {
          const specType = spec.type as string;
          const isSpecType = isType || (spec.importKind as string) === 'type';
          const meta: Record<string, unknown> = {};
          if (isSpecType) meta.isType = true;

          let dstSymbolName: string;
          let srcSymbolName: string;

          if (specType === 'ImportDefaultSpecifier') {
            dstSymbolName = 'default';
            srcSymbolName = (spec.local as { name: string }).name;
          } else if (specType === 'ImportNamespaceSpecifier') {
            dstSymbolName = '*';
            srcSymbolName = (spec.local as { name: string }).name;
            meta.importKind = 'namespace';
          } else {
            // ImportSpecifier
            dstSymbolName = (spec.imported as { name: string }).name;
            srcSymbolName = (spec.local as { name: string }).name;
          }

          relations.push({
            type: isSpecType ? 'type-references' : 'imports',
            srcFilePath: filePath,
            srcSymbolName,
            dstFilePath: resolved,
            dstSymbolName,
            ...(Object.keys(meta).length > 0 ? { metaJson: JSON.stringify(meta) } : {}),
          });
        }
      }
      continue;
    }

    if (node.type === 'ExportAllDeclaration' && node.source) {
      const sourcePath: string = ((node.source as { value?: string } | undefined)?.value) ?? '';
      const candidates = resolveImportFn(filePath, sourcePath, tsconfigPaths);
      if (candidates.length === 0) continue;
      const resolved = candidates[0]!;

      const isType = node.exportKind === 'type';
      const meta: Record<string, unknown> = { isReExport: true };
      if (isType) meta.isType = true;
      relations.push({
        type: isType ? 'type-references' : 're-exports',
        srcFilePath: filePath,
        srcSymbolName: null,
        dstFilePath: resolved,
        dstSymbolName: null,
        metaJson: JSON.stringify(meta),
      });
      continue;
    }

    if (node.type === 'ExportNamedDeclaration' && node.source) {
      const sourcePath: string = ((node.source as { value?: string } | undefined)?.value) ?? '';
      const candidates = resolveImportFn(filePath, sourcePath, tsconfigPaths);
      if (candidates.length === 0) continue;
      const resolved = candidates[0]!;

      const isType = node.exportKind === 'type';
      const specifierNodes = (node.specifiers as Array<Record<string, unknown>> | undefined) ?? [];
      const specifiers = specifierNodes.map((s) => ({
        local: (s.local as { name: string }).name,
        exported: (s.exported as { name: string }).name,
      }));

      const meta: Record<string, unknown> = { isReExport: true, specifiers };
      if (isType) meta.isType = true;

      relations.push({
        type: isType ? 'type-references' : 're-exports',
        srcFilePath: filePath,
        srcSymbolName: null,
        dstFilePath: resolved,
        dstSymbolName: null,
        metaJson: JSON.stringify(meta),
      });
    }
  }

  visit(ast, (node) => {
    if (node.type !== 'ImportExpression') return;
    const sourceValue = getStringLiteralValue(node.source);
    if (!sourceValue) return;
    const candidates = resolveImportFn(filePath, sourceValue, tsconfigPaths);
    if (candidates.length === 0) return;
    const resolved = candidates[0]!;

    relations.push({
      type: 'imports',
      srcFilePath: filePath,
      srcSymbolName: null,
      dstFilePath: resolved,
      dstSymbolName: null,
      metaJson: JSON.stringify({ isDynamic: true }),
    });
  });

  return relations;
}
