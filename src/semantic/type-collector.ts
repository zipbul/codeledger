/**
 * TypeCollector — tsc TypeChecker 직접 호출로 심볼의 ResolvedType을 수집한다.
 *
 * TscProgram에서 Program/TypeChecker를 가져와 AST를 탐색하고
 * 각 심볼 위치의 타입을 ResolvedType으로 변환한다.
 */

import ts from "typescript";
import type { ResolvedType } from "./types";
import type { TscProgram } from "./tsc-program";
import { findNodeAtPosition } from "./ast-node-utils";

// ── ResolvedType 빌더 ────────────────────────────────────────────────────────

/**
 * ResolvedType 트리의 최대 재귀 깊이.
 *
 * 이 값을 초과하면 `members`와 `typeArguments`를 전개하지 않고
 * leaf 노드로 처리한다. `text` 필드는 depth와 무관하게 항상 채워진다.
 */
const MAX_TYPE_DEPTH = 8;

/** TypeReference 여부 판별 (generic instantiation). */
function isTypeReference(type: ts.Type): type is ts.TypeReference {
  return (
    !!(type.flags & ts.TypeFlags.Object) &&
    !!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference)
  );
}

/**
 * `ts.Type`을 `ResolvedType`으로 재귀 변환한다.
 *
 * 순환 타입에 대비해 `depth`로 재귀 깊이를 제한한다.
 */
function buildResolvedType(
  checker: ts.TypeChecker,
  type: ts.Type,
  depth = 0,
): ResolvedType {
  const text = checker.typeToString(type);
  const flags = type.flags;

  const isUnion = !!(flags & ts.TypeFlags.Union);
  const isIntersection = !!(flags & ts.TypeFlags.Intersection);

  // TypeReference의 구체화된 타입 인자를 public API로 가져온다.
  // (type as ts.TypeReference).typeArguments 대신 checker.getTypeArguments() 사용.
  let typeArgs: readonly ts.Type[] | undefined;
  if (depth < MAX_TYPE_DEPTH && isTypeReference(type)) {
    const args = checker.getTypeArguments(type);
    if (args.length > 0) typeArgs = args;
  }

  // isGeneric: 타입 파라미터 자체이거나 타입 인자가 구체화된 TypeReference
  const isGeneric =
    !!(flags & ts.TypeFlags.TypeParameter) ||
    (typeArgs !== undefined && typeArgs.length > 0);

  // union / intersection 구성원 재귀 빌드
  let members: ResolvedType[] | undefined;
  if (isUnion && depth < MAX_TYPE_DEPTH) {
    members = (type as ts.UnionType).types.map((t) =>
      buildResolvedType(checker, t, depth + 1),
    );
  } else if (isIntersection && depth < MAX_TYPE_DEPTH) {
    members = (type as ts.IntersectionType).types.map((t) =>
      buildResolvedType(checker, t, depth + 1),
    );
  }

  // 타입 인자 재귀 빌드
  let typeArguments: ResolvedType[] | undefined;
  if (typeArgs && typeArgs.length > 0) {
    typeArguments = typeArgs.map((t) =>
      buildResolvedType(checker, t, depth + 1),
    );
  }

  return { text, flags, isUnion, isIntersection, isGeneric, members, typeArguments };
}

// ── 선언 위치 순회 ───────────────────────────────────────────────────────────

/** 선언 이름인 Identifier 노드인지 판별한다. */
function isNamedDeclaration(node: ts.Node): node is ts.NamedDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isPropertySignature(node) ||
    ts.isMethodSignature(node)
  );
}

// ── TypeCollector ─────────────────────────────────────────────────────────────

export class TypeCollector {
  constructor(private readonly program: TscProgram) {}

  /**
   * `filePath`의 `position` 위치(0-based 문자 오프셋)에 있는 심볼의 타입을 수집한다.
   *
   * - 파일이 없거나 위치에 식별자가 없으면 `null` 반환
   * - `TscProgram이` disposed 상태이면 throw (getProgram이 throw)
   */
  collectAt(filePath: string, position: number): ResolvedType | null {
    // disposed 체크는 getProgram/getChecker가 대신 throw
    const tsProgram = this.program.getProgram();
    const checker = this.program.getChecker();

    if (position < 0) return null;

    const sourceFile = tsProgram.getSourceFile(filePath);
    if (!sourceFile) return null;

    if (position >= sourceFile.getEnd()) return null;

    const node = findNodeAtPosition(sourceFile, position);
    if (!node) return null;

    // 식별자가 아니면 (keyword, 구두점 등) 타입 수집 불가
    if (!ts.isIdentifier(node)) return null;

    try {
      const type = checker.getTypeAtLocation(node);
      // error/unknown flag 조합으로 never에 가까운 타입은 그대로 전달
      return buildResolvedType(checker, type);
    } catch {
      return null;
    }
  }

  /**
   * 두 위치의 타입 호환성을 검사한다.
   *
   * `sourceFilePath:sourcePosition`의 타입이 `targetFilePath:targetPosition`의 타입에
   * 할당 가능한지 여부를 반환한다.
   *
   * - 파일이 없거나 위치에 식별자가 없으면 `null` 반환
   * - `TscProgram`이 disposed 상태이면 throw (getProgram이 throw)
   */
  isAssignableTo(
    sourceFilePath: string,
    sourcePosition: number,
    targetFilePath: string,
    targetPosition: number,
  ): boolean | null {
    const checker = this.program.getChecker();
    const tsProgram = this.program.getProgram();

    const srcFile = tsProgram.getSourceFile(sourceFilePath);
    if (!srcFile) return null;
    const srcNode = findNodeAtPosition(srcFile, sourcePosition);
    if (!srcNode || !ts.isIdentifier(srcNode)) return null;

    const dstFile = tsProgram.getSourceFile(targetFilePath);
    if (!dstFile) return null;
    const dstNode = findNodeAtPosition(dstFile, targetPosition);
    if (!dstNode || !ts.isIdentifier(dstNode)) return null;

    try {
      const sourceType = checker.getTypeAtLocation(srcNode);
      const targetType = checker.getTypeAtLocation(dstNode);
      return checker.isTypeAssignableTo(sourceType, targetType);
    } catch {
      return null;
    }
  }

  /**
   * `filePath`에서 모든 선언 이름 심볼의 타입을 수집한다.
   *
   * 반환 Map의 key = 선언 이름 식별자의 시작 위치(0-based).
   * 파일이 없으면 빈 Map 반환.
   * `TscProgram`이 disposed 상태이면 throw.
   */
  collectFile(filePath: string): Map<number, ResolvedType> {
    const result = new Map<number, ResolvedType>();

    const tsProgram = this.program.getProgram();
    const checker = this.program.getChecker();

    const sourceFile = tsProgram.getSourceFile(filePath);
    if (!sourceFile) return result;

    function visit(node: ts.Node): void {
      if (isNamedDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
        const nameNode = node.name;
        try {
          const type = checker.getTypeAtLocation(nameNode);
          const pos = nameNode.getStart(sourceFile!);
          result.set(pos, buildResolvedType(checker, type));
        } catch {
          // 타입 수집 실패 심볼은 건너뜀
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
    return result;
  }
}
