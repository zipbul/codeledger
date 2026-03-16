import type { ParsedFile, SourceSpan } from '../parser/types';
import type { ExtractedAnnotation, AnnotationSource, JsDocBlock } from './types';
import { extractSymbols } from './symbol-extractor';
import { parseJsDoc } from '../parser/jsdoc-parser';
import { isErr } from '@zipbul/result';
import { buildLineOffsets, getLineColumn } from '../parser/source-position';

const TAG_RE = /(?:^|\s)@([a-zA-Z][\w-]*\w|[a-zA-Z])\s*(.*)$/m;

interface FlatSymbol {
  name: string;
  startLine: number;
}

function flattenSymbols(parsed: ParsedFile): FlatSymbol[] {
  const extracted = extractSymbols(parsed);
  const flat: FlatSymbol[] = [];
  for (const sym of extracted) {
    flat.push({ name: sym.name, startLine: sym.span.start.line });
    for (const member of sym.members ?? []) {
      flat.push({ name: `${sym.name}.${member.name}`, startLine: member.span.start.line });
    }
  }
  flat.sort((a, b) => a.startLine - b.startLine);
  return flat;
}

function findNextSymbol(flat: FlatSymbol[], endLine: number, maxGap: number): string | null {
  let lo = 0;
  let hi = flat.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (flat[mid]!.startLine <= endLine) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (lo < flat.length) {
    const sym = flat[lo]!;
    if (sym.startLine - endLine <= maxGap) return sym.name;
  }
  return null;
}

function makeSpan(
  offsets: number[],
  start: number,
  end: number,
): SourceSpan {
  const s = getLineColumn(offsets, start);
  const e = getLineColumn(offsets, end);
  return { start: s, end: e };
}

export function extractAnnotations(parsed: ParsedFile): ExtractedAnnotation[] {
  const { comments, sourceText } = parsed;
  if (!comments.length) return [];

  const offsets = buildLineOffsets(sourceText);
  const flat = flattenSymbols(parsed);
  const results: ExtractedAnnotation[] = [];

  const sorted = [...comments].sort((a, b) => a.start - b.start);

  let prevLineAnnotation: { annotation: ExtractedAnnotation; endLine: number } | null = null;

  for (const comment of sorted) {
    if (comment.type === 'Block' && comment.value.startsWith('*')) {
      // JSDoc block
      prevLineAnnotation = null;
      const fullText = `/*${comment.value}*/`;
      const jsDocResult = parseJsDoc(fullText);
      if (isErr(jsDocResult)) continue;
      const jsDoc = jsDocResult as JsDocBlock;
      if (!jsDoc.tags?.length) continue;

      const commentEnd = getLineColumn(offsets, comment.end);
      const symbolName = findNextSymbol(flat, commentEnd.line, 3);
      const commentSlice = sourceText.slice(comment.start, comment.end);

      for (const t of jsDoc.tags) {
        const value = [t.name, t.description].filter(Boolean).join(' ');
        const tagSearch = `@${t.tag}`;
        const idx = commentSlice.indexOf(tagSearch);
        let span: SourceSpan;
        if (idx >= 0) {
          const tagStart = comment.start + idx;
          const lineEnd = sourceText.indexOf('\n', tagStart);
          const tagEnd = lineEnd >= 0 ? Math.min(lineEnd, comment.end) : comment.end;
          span = makeSpan(offsets, tagStart, tagEnd);
        } else {
          span = makeSpan(offsets, comment.start, comment.end);
        }

        results.push({
          tag: t.tag,
          value,
          source: 'jsdoc' as AnnotationSource,
          span,
          symbolName,
        });
      }
    } else if (comment.type === 'Block') {
      // Non-JSDoc block comment
      prevLineAnnotation = null;
      const lines = comment.value.split('\n');
      let lineOffset = 0;
      for (const line of lines) {
        const cleaned = line.replace(/^\s*\*?\s?/, '');
        const match = TAG_RE.exec(cleaned);
        if (match) {
          const tag = match[1]!;
          const value = match[2]?.trim() ?? '';
          const tagStr = `@${tag}`;
          const tagIdx = line.indexOf(tagStr);
          const absStart = comment.start + 2 + lineOffset + (tagIdx >= 0 ? tagIdx : 0);
          const absEnd = comment.start + 2 + lineOffset + line.length;
          const span = makeSpan(offsets, absStart, absEnd);
          const commentEnd = getLineColumn(offsets, comment.end);
          const symbolName = findNextSymbol(flat, commentEnd.line, 3);

          results.push({ tag, value, source: 'block' as AnnotationSource, span, symbolName });
        }
        lineOffset += line.length + 1; // +1 for \n
      }
    } else {
      // Line comment
      const cleaned = comment.value;
      const match = TAG_RE.exec(cleaned);
      const commentStart = getLineColumn(offsets, comment.start);
      const commentEnd = getLineColumn(offsets, comment.end);

      if (match) {
        const tag = match[1]!;
        const value = match[2]?.trim() ?? '';
        const tagStr = `@${tag}`;
        const tagIdx = cleaned.indexOf(tagStr);
        const absStart = comment.start + 2 + (tagIdx >= 0 ? tagIdx : 0); // +2 for //
        const span = makeSpan(offsets, absStart, comment.end);
        const symbolName = findNextSymbol(flat, commentEnd.line, 3);

        const annotation: ExtractedAnnotation = {
          tag, value, source: 'line' as AnnotationSource, span, symbolName,
        };
        results.push(annotation);
        prevLineAnnotation = { annotation, endLine: commentEnd.line };
      } else if (prevLineAnnotation && commentStart.line === prevLineAnnotation.endLine + 1) {
        // Continuation line — append to previous annotation's value
        const trimmed = cleaned.trim();
        if (trimmed) {
          prevLineAnnotation.annotation.value += ' ' + trimmed;
          prevLineAnnotation.annotation.span.end = getLineColumn(offsets, comment.end);
          prevLineAnnotation.endLine = commentEnd.line;
        }
      } else {
        prevLineAnnotation = null;
      }
    }
  }

  return results;
}
