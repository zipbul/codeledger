/**
 * ReferenceResolver — LanguageService.findReferences 기반 시맨틱 참조 탐색.
 *
 * 텍스트 검색과 달리 심볼 identity 기반으로 참조를 찾으므로
 * rename, re-export, shadowing을 정확히 처리한다.
 */

import ts from "typescript";
import type { SemanticReference } from "./types";
import type { TscProgram } from "./tsc-program";
import { findNodeAtPosition } from "./ast-node-utils";

// ── ReferenceResolver ─────────────────────────────────────────────────────────

export class ReferenceResolver {
  readonly #program: TscProgram;

  constructor(program: TscProgram) {
    this.#program = program;
  }

  /**
   * `filePath`의 `position` 위치 심볼에 대한 모든 참조를 찾는다.
   *
   * - 프로그램이 dispose되었거나 심볼을 찾을 수 없으면 빈 배열을 반환한다.
   * - LanguageService.findReferences를 사용하므로 cross-file 참조도 포함된다.
   */
  findAt(filePath: string, position: number): SemanticReference[] {
    // disposed 체크
    if (this.#program.isDisposed) return [];

    // SourceFile 조회
    const prog = this.#program.getProgram();
    const sourceFile = prog.getSourceFile(filePath);
    if (!sourceFile) return [];

    // AST 탐색 — identifier 노드만 허용
    const node = findNodeAtPosition(sourceFile, position);
    if (!node || !ts.isIdentifier(node)) return [];

    // LanguageService.findReferences
    const ls = this.#program.getLanguageService();
    const referencedSymbols = ls.findReferences(filePath, position);
    if (!referencedSymbols || referencedSymbols.length === 0) return [];

    // SemanticReference[] 변환
    const results: SemanticReference[] = [];

    for (const refSymbol of referencedSymbols) {
      for (const entry of refSymbol.references) {
        const refSourceFile = prog.getSourceFile(entry.fileName);
        if (!refSourceFile) continue;

        const { line: lineZero, character: column } =
          refSourceFile.getLineAndCharacterOfPosition(entry.textSpan.start);

        results.push({
          filePath: entry.fileName,
          position: entry.textSpan.start,
          line: lineZero + 1, // 1-based
          column, // 0-based
          isDefinition: entry.isDefinition ?? false,
          isWrite: entry.isWriteAccess ?? false,
        });
      }
    }

    return results;
  }
}
