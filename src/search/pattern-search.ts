import { findInFiles, Lang } from '@ast-grep/napi';

/**
 * A single structural-pattern match found in a source file.
 */
export interface PatternMatch {
  /** Absolute path of the file containing the match. */
  filePath: string;
  /** 1-based start line number of the matched node. */
  startLine: number;
  /** 1-based end line number of the matched node. */
  endLine: number;
  /** Source text of the matched node. */
  matchedText: string;
}

/**
 * Options for {@link patternSearch}.
 */
export interface PatternSearchOptions {
  /** An ast-grep structural pattern string (e.g. `'console.log($$$)'`). */
  pattern: string;
  /** Absolute file paths (or directories) to search within. */
  filePaths: string[];
}

/**
 * Search for a structural AST pattern across a set of TypeScript/TSX files
 * using ast-grep's `findInFiles` API.
 *
 * @param opts - Pattern and file paths to search.
 * @returns An array of {@link PatternMatch} entries for all matching nodes.
 */
export async function patternSearch(opts: PatternSearchOptions): Promise<PatternMatch[]> {
  if (opts.filePaths.length === 0) return [];

  const matches: PatternMatch[] = [];

  await findInFiles(
    Lang.TypeScript,
    {
      paths: opts.filePaths,
      matcher: { rule: { pattern: opts.pattern } },
    },
    (err, nodes) => {
      if (err) return;
      for (const node of nodes) {
        const r = node.range();
        matches.push({
          filePath: node.getRoot().filename(),
          startLine: r.start.line + 1,
          endLine: r.end.line + 1,
          matchedText: node.text(),
        });
      }
    },
  );

  return matches;
}
