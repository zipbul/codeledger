import type { ParsedFile } from '../parser/types';
import type { ExtractedSymbol } from '../extractor/types';
import { extractSymbols } from '../extractor/symbol-extractor';
import { hashString } from '../common/hasher';

export interface SymbolDbRow {
  project: string;
  filePath: string;
  kind: string;
  name: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  isExported: number;
  signature: string | null;
  fingerprint: string | null;
  detailJson: string | null;
  contentHash: string;
  indexedAt: string;
}

interface SymbolRepoPart {
  replaceFileSymbols(
    project: string,
    filePath: string,
    contentHash: string,
    symbols: SymbolDbRow[],
  ): void;
}

export interface IndexFileSymbolsOptions {
  parsed: ParsedFile;
  project: string;
  filePath: string;
  contentHash: string;
  symbolRepo: SymbolRepoPart;
}

function buildSignature(sym: ExtractedSymbol): string | null {
  if (sym.kind === 'function' || sym.kind === 'method') {
    const paramCount = sym.parameters?.length ?? 0;
    const isAsync = sym.modifiers.includes('async') ? 1 : 0;
    return `params:${paramCount}|async:${isAsync}`;
  }
  return null;
}

function buildDetailJson(sym: ExtractedSymbol): string | null {
  const detail: Record<string, unknown> = {};

  if (sym.jsDoc) detail.jsDoc = sym.jsDoc;

  if (sym.kind === 'function' || sym.kind === 'method') {
    if (sym.parameters !== undefined) detail.parameters = sym.parameters;
    if (sym.returnType !== undefined) detail.returnType = sym.returnType;
  }

  if (sym.heritage?.length) detail.heritage = sym.heritage;
  if (sym.decorators?.length) detail.decorators = sym.decorators;
  if (sym.typeParameters?.length) detail.typeParameters = sym.typeParameters;
  if (sym.modifiers?.length) detail.modifiers = sym.modifiers;
  if (sym.members?.length) {
    detail.members = sym.members.map((m) => {
      const visibility = m.modifiers.find(
        (mod: string) => mod === 'private' || mod === 'protected' || mod === 'public',
      );
      return {
        name: m.name,
        kind: m.methodKind ?? m.kind,
        type: m.returnType,
        visibility,
        isStatic: m.modifiers.includes('static') || undefined,
        isReadonly: m.modifiers.includes('readonly') || undefined,
      };
    });
  }

  return Object.keys(detail).length > 0 ? JSON.stringify(detail) : null;
}

function buildRow(
  sym: ExtractedSymbol,
  name: string,
  project: string,
  filePath: string,
  contentHash: string,
): SymbolDbRow {
  const signature = buildSignature(sym);
  const fingerprint = hashString(`${name}|${sym.kind}|${signature ?? ''}`);

  return {
    project,
    filePath,
    kind: sym.kind,
    name,
    startLine: sym.span.start.line,
    startColumn: sym.span.start.column,
    endLine: sym.span.end.line,
    endColumn: sym.span.end.column,
    isExported: sym.isExported ? 1 : 0,
    signature,
    fingerprint,
    detailJson: buildDetailJson(sym),
    contentHash,
    indexedAt: new Date().toISOString(),
  };
}

export function indexFileSymbols(opts: IndexFileSymbolsOptions): void {
  const { parsed, project, filePath, contentHash, symbolRepo } = opts;

  const extracted = extractSymbols(parsed);
  const rows: SymbolDbRow[] = [];

  for (const sym of extracted) {
    rows.push(buildRow(sym, sym.name, project, filePath, contentHash));

    for (const member of sym.members ?? []) {
      rows.push(buildRow(member, `${sym.name}.${member.name}`, project, filePath, contentHash));
    }
  }

  symbolRepo.replaceFileSymbols(project, filePath, contentHash, rows);
}
