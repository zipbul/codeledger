import { err, type Result } from '@zipbul/result';
import { parse } from 'comment-parser';
import type { JsDocBlock } from '../extractor/types';
import { gildashError, type GildashError } from '../errors';

export function parseJsDoc(commentText: string): Result<JsDocBlock, GildashError> {
  try {
    let stripped = commentText.trim();
    if (stripped.startsWith('/**')) stripped = stripped.slice(3);
    if (stripped.endsWith('*/')) stripped = stripped.slice(0, -2);

    const blocks = parse(`/** ${stripped} */`);
    const block = blocks[0] ?? { description: '', tags: [] };

    return {
      description: (block.description ?? '').trim(),
      tags: (block.tags ?? []).map((t) => ({
        tag: t.tag ?? '',
        name: t.name ?? '',
        type: t.type ?? '',
        description: t.description ?? '',
        optional: t.optional ?? false,
        ...(t.default !== undefined ? { default: t.default } : {}),
      })),
    };
  } catch (e) {
    return err(gildashError('parse', 'Failed to parse JSDoc comment', e));
  }
}
