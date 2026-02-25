/**
 * ImplementationFinder — findImplementations + isTypeAssignableTo 기반 구현체 탐색.
 *
 * interface/abstract class의 구현체를 찾는다.
 * - LanguageService.getImplementationAtPosition: 명시적 + 일부 구조적 구현체
 * - TypeChecker.isTypeAssignableTo: 덕 타이핑 구현체 검증
 *
 * 명시적(`implements` 키워드) 구현과 구조적(duck-typing) 구현 모두 탐지한다.
 */

import ts from "typescript";
import type { Implementation } from "./types";
import type { TscProgram } from "./tsc-program";
import { findNodeAtPosition } from "./ast-node-utils";

/**
 * `pos` 위치에서 가장 가까운 선언(declaration) 노드를 찾는다.
 * identifier에서 부모를 타고 올라가며 선언 노드를 탐색한다.
 */
function findDeclarationAtPosition(
  sourceFile: ts.SourceFile,
  pos: number,
): ts.Node | undefined {
  const node = findNodeAtPosition(sourceFile, pos);
  if (!node) return undefined;

  // 이미 선언 노드이면 바로 반환
  if (isDeclarationNode(node)) return node;

  // 부모를 타고 올라가며 선언 노드 탐색 (최대 5단계)
  let current: ts.Node | undefined = node.parent;
  for (let i = 0; i < 5 && current; i++) {
    if (isDeclarationNode(current)) return current;
    current = current.parent;
  }

  return node;
}

function isDeclarationNode(node: ts.Node): boolean {
  return (
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isObjectLiteralExpression(node)
  );
}

// ── Kind 분류 ─────────────────────────────────────────────────────────────────

/**
 * AST 노드에서 Implementation.kind를 결정한다.
 */
function classifyKind(node: ts.Node): Implementation["kind"] {
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    return "class";
  }

  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  ) {
    return "function";
  }

  if (ts.isObjectLiteralExpression(node)) {
    return "object";
  }

  // VariableDeclaration → initializer 타입에 따라 분류
  if (ts.isVariableDeclaration(node) && node.initializer) {
    return classifyKind(node.initializer);
  }

  // default
  return "class";
}

// ── 심볼 이름 추출 ────────────────────────────────────────────────────────────

/**
 * 선언 노드에서 심볼 이름을 추출한다.
 */
function extractSymbolName(node: ts.Node, sourceFile: ts.SourceFile): string {
  // ClassDeclaration / FunctionDeclaration — name 프로퍼티
  if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) {
    return node.name?.getText(sourceFile) ?? "";
  }

  // ClassExpression — name이 있을 수도 없을 수도
  if (ts.isClassExpression(node)) {
    return node.name?.getText(sourceFile) ?? "";
  }

  // VariableDeclaration — name identifier
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.getText(sourceFile);
  }

  // FunctionExpression
  if (ts.isFunctionExpression(node)) {
    return node.name?.getText(sourceFile) ?? "";
  }

  // ArrowFunction — 부모 VariableDeclaration에서 이름
  if (ts.isArrowFunction(node) && node.parent && ts.isVariableDeclaration(node.parent)) {
    if (ts.isIdentifier(node.parent.name)) {
      return node.parent.name.getText(sourceFile);
    }
  }

  // ObjectLiteralExpression — 부모 VariableDeclaration에서 이름
  if (ts.isObjectLiteralExpression(node) && node.parent && ts.isVariableDeclaration(node.parent)) {
    if (ts.isIdentifier(node.parent.name)) {
      return node.parent.name.getText(sourceFile);
    }
  }

  return "";
}

// ── isExplicit 판정 ───────────────────────────────────────────────────────────

/**
 * 선언 노드가 `implements` 키워드를 사용하는지 확인한다.
 */
function checkIsExplicit(node: ts.Node): boolean {
  // ClassDeclaration / ClassExpression만 implements 가능
  if (!ts.isClassDeclaration(node) && !ts.isClassExpression(node)) {
    return false;
  }

  const heritageClauses = node.heritageClauses;
  if (!heritageClauses) return false;

  return heritageClauses.some(
    (clause) => clause.token === ts.SyntaxKind.ImplementsKeyword,
  );
}

// ── ImplementationFinder ──────────────────────────────────────────────────────

export class ImplementationFinder {
  readonly #program: TscProgram;

  constructor(program: TscProgram) {
    this.#program = program;
  }

  /**
   * `filePath`의 `position` 위치 심볼에 대한 구현체를 찾는다.
   *
   * - 프로그램이 dispose되었거나 심볼을 찾을 수 없으면 빈 배열을 반환한다.
   * - 명시적 `implements` + 구조적 타이핑(duck-typing) 구현체 모두 포함한다.
   */
  findAt(filePath: string, position: number): Implementation[] {
    // Branch 1: disposed 체크
    if (this.#program.isDisposed) return [];

    // SourceFile 조회
    const prog = this.#program.getProgram();
    // Branch 2: sourceFile 없음
    const sourceFile = prog.getSourceFile(filePath);
    if (!sourceFile) return [];

    // Branch 3, 4: AST 탐색 — identifier 노드만 허용
    const node = findNodeAtPosition(sourceFile, position);
    if (!node || !ts.isIdentifier(node)) return [];

    // LanguageService.getImplementationAtPosition
    const ls = this.#program.getLanguageService();
    const implLocations = ls.getImplementationAtPosition(filePath, position);
    // Branch 5: 결과 없음
    if (!implLocations || implLocations.length === 0) return [];

    const results: Implementation[] = [];

    for (const loc of implLocations) {
      // interface/type alias 자체는 skip (구현체가 아님)
      if (
        loc.kind === ts.ScriptElementKind.interfaceElement ||
        loc.kind === ts.ScriptElementKind.typeElement
      ) {
        continue;
      }

      // Branch 6: sourceFile 없는 결과 entry skip
      const implSourceFile = prog.getSourceFile(loc.fileName);
      if (!implSourceFile) continue;

      // 선언 노드 탐색
      const declNode = findDeclarationAtPosition(implSourceFile, loc.textSpan.start);
      if (!declNode) continue;

      // Branch 7: kind 분류
      const kind = classifyKind(declNode);
      // symbolName 추출
      const symbolName = extractSymbolName(declNode, implSourceFile);
      // Branch 8: isExplicit 판정
      const isExplicit = checkIsExplicit(declNode);

      results.push({
        filePath: loc.fileName,
        symbolName,
        position: loc.textSpan.start,
        kind,
        isExplicit,
      });
    }

    return results;
  }
}
