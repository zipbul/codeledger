/**
 * SymbolGraph — tsc Symbol API로 심볼의 계층(parent/members/exports)을 탐색하고
 * LRU 캐시로 결과를 재사용한다.
 */

import ts from "typescript";
import { LruCache } from "../common/lru-cache";
import type { TscProgram } from "./tsc-program";

// ── Public types ─────────────────────────────────────────────────────────────

export interface SymbolNode {
  /** 심볼 이름 (`ts.Symbol.getName()`) */
  name: string;
  /** 첫 번째 선언이 위치한 파일 경로 */
  filePath: string;
  /** 첫 번째 선언의 이름 식별자 `getStart()` 오프셋 */
  position: number;
  /** 컨테이너 심볼 (namespace·class·enum의 멤버인 경우) */
  parent?: SymbolNode;
  /** 클래스·인터페이스·enum의 멤버 심볼 목록 */
  members?: SymbolNode[];
  /** namespace의 export 심볼 목록 */
  exports?: SymbolNode[];
}

// ── 내부 상수 ─────────────────────────────────────────────────────────────────

const DEFAULT_CAPACITY = 1_000;

/** tsc 내부 Symbol — parent는 공개 API에 없으므로 별도 타입으로 접근한다. */
type InternalSymbol = ts.Symbol & { parent?: ts.Symbol };
/** members/exports 재귀 최대 깊이 */
const MAX_MEMBER_DEPTH = 1;

// ── AST 탐색 헬퍼 ────────────────────────────────────────────────────────────

/**
 * `pos` 위치의 가장 작은(innermost) 노드를 반환한다.
 * 범위 밖이면 `undefined`.
 */
function findNodeAtPosition(
  sourceFile: ts.SourceFile,
  pos: number,
): ts.Node | undefined {
  if (pos < 0 || pos >= sourceFile.getEnd()) return undefined;

  function visit(node: ts.Node): ts.Node | undefined {
    const start = node.getStart(sourceFile, false);
    const end = node.getEnd();

    if (pos < start || pos >= end) return undefined;

    let found: ts.Node | undefined;
    ts.forEachChild(node, (child) => {
      if (!found) found = visit(child);
    });
    return found ?? node;
  }

  return visit(sourceFile);
}

// ── SymbolNode 빌더 ──────────────────────────────────────────────────────────

/**
 * 컨테이너 심볼을 name·filePath·position만으로 얕게 빌드한다.
 * (parent-of-parent 재귀 방지)
 */
function buildParentNode(symbol: ts.Symbol): SymbolNode {
  const decl = symbol.declarations?.[0];
  const sourceFile = decl?.getSourceFile();
  const nameNode = decl
    ? ts.getNameOfDeclaration(decl as ts.Declaration)
    : undefined;
  return {
    name: symbol.getName(),
    filePath: sourceFile?.fileName ?? "",
    position:
      nameNode?.getStart(sourceFile, false) ??
      decl?.getStart(sourceFile, false) ??
      0,
  };
}

/**
 * `ts.Symbol`을 `SymbolNode`로 변환한다.
 *
 * @param symbol  변환할 심볼
 * @param depth   현재 재귀 깊이 (members/exports 탐색 제한)
 */
function buildSymbolNode(symbol: InternalSymbol, depth = 0): SymbolNode {
  const decl = symbol.declarations?.[0];
  const sourceFile = decl?.getSourceFile();
  const nameNode = decl
    ? ts.getNameOfDeclaration(decl as ts.Declaration)
    : undefined;
  const filePath = sourceFile?.fileName ?? "";
  const position =
    nameNode?.getStart(sourceFile, false) ??
    decl?.getStart(sourceFile, false) ??
    0;

  const node: SymbolNode = {
    name: symbol.getName(),
    filePath,
    position,
  };

  // parent — 컨테이너 심볼이 있으면 얕게 빌드
  const internalSym = symbol as InternalSymbol;
  if (internalSym.parent) {
    node.parent = buildParentNode(internalSym.parent);
  }

  if (depth < MAX_MEMBER_DEPTH) {
    const flags = symbol.flags;
    const isEnum = !!(flags & ts.SymbolFlags.Enum);
    const isNamespace = !!(
      flags &
      (ts.SymbolFlags.NamespaceModule | ts.SymbolFlags.ValueModule)
    );
    const isClassOrInterface = !!(
      flags &
      (ts.SymbolFlags.Class | ts.SymbolFlags.Interface)
    );

    // members — class/interface: symbol.members / enum: symbol.exports
    if (isEnum && symbol.exports && symbol.exports.size > 0) {
      const members: SymbolNode[] = [];
      symbol.exports.forEach((memberSym) => {
        members.push(buildSymbolNode(memberSym, depth + 1));
      });
      node.members = members;
    } else if (isClassOrInterface && symbol.members && symbol.members.size > 0) {
      const members: SymbolNode[] = [];
      symbol.members.forEach((memberSym) => {
        members.push(buildSymbolNode(memberSym, depth + 1));
      });
      node.members = members;
    }

    // exports — namespace: symbol.exports
    if (isNamespace && symbol.exports && symbol.exports.size > 0) {
      const exports: SymbolNode[] = [];
      symbol.exports.forEach((exportSym) => {
        exports.push(buildSymbolNode(exportSym, depth + 1));
      });
      node.exports = exports;
    }
  }

  return node;
}

// ── SymbolGraph ───────────────────────────────────────────────────────────────

export class SymbolGraph {
  readonly #program: TscProgram;
  readonly #cache: LruCache<string, SymbolNode>;
  /** filePath → Set<cacheKey> (invalidate 효율화용) */
  readonly #fileKeys = new Map<string, Set<string>>();

  constructor(program: TscProgram, capacity = DEFAULT_CAPACITY) {
    this.#program = program;
    this.#cache = new LruCache<string, SymbolNode>(capacity);
  }

  /**
   * `filePath`의 `position` 위치 심볼을 `SymbolNode`로 반환한다.
   * - 프로그램이 dispose되었거나 심볼을 찾을 수 없으면 `null`을 반환한다.
   * - 결과는 LRU 캐시에 저장된다.
   */
  get(filePath: string, position: number): SymbolNode | null {
    // disposed 체크
    if (this.#program.isDisposed) return null;

    // 캐시 히트
    const cacheKey = `${filePath}:${position}`;
    const cached = this.#cache.get(cacheKey);
    if (cached !== undefined) return cached;

    // SourceFile 조회
    const prog = this.#program.getProgram();
    const sourceFile = prog.getSourceFile(filePath);
    if (!sourceFile) return null;

    // AST 탐색 — identifier 노드를 찾아야 함
    const node = findNodeAtPosition(sourceFile, position);
    if (!node || !ts.isIdentifier(node)) return null;

    // 심볼 조회
    const checker = this.#program.getChecker();
    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol) return null;

    // SymbolNode 빌드 + 캐시 저장
    const symbolNode = buildSymbolNode(symbol as InternalSymbol);
    this.#cache.set(cacheKey, symbolNode);

    // filePath → keys 인덱스 갱신
    let keys = this.#fileKeys.get(filePath);
    if (!keys) {
      keys = new Set<string>();
      this.#fileKeys.set(filePath, keys);
    }
    keys.add(cacheKey);

    return symbolNode;
  }

  /**
   * `filePath`에 해당하는 캐시 항목을 모두 제거한다.
   * 파일 변경 시 호출하여 stale 결과를 무효화한다.
   */
  invalidate(filePath: string): void {
    const keys = this.#fileKeys.get(filePath);
    if (keys) {
      for (const key of keys) {
        this.#cache.delete(key);
      }
      this.#fileKeys.delete(filePath);
    }
  }

  /** 캐시 전체를 초기화한다. */
  clear(): void {
    this.#cache.clear();
    this.#fileKeys.clear();
  }
}
