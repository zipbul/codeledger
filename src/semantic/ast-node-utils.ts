/**
 * Shared AST node utilities for the semantic layer.
 */

import ts from "typescript";

/**
 * `pos` 위치의 가장 작은(innermost) 노드를 반환한다.
 * 범위 밖이면 `undefined`.
 */
export function findNodeAtPosition(
  sourceFile: ts.SourceFile,
  pos: number,
): ts.Node | undefined {
  if (pos < 0 || pos >= sourceFile.getEnd()) return undefined;

  function visit(node: ts.Node): ts.Node | undefined {
    const start = node.getStart(sourceFile, false);
    const end = node.getEnd();

    if (pos < start || pos >= end) return undefined;

    // 자식 중 더 좁은 노드 탐색
    let found: ts.Node | undefined;
    ts.forEachChild(node, (child) => {
      if (!found) found = visit(child);
    });
    return found ?? node;
  }

  return visit(sourceFile);
}
