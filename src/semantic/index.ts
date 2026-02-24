/**
 * SemanticLayer — tsc 기반 시맨틱 분석 계층.
 *
 * TscProgram + TypeCollector + SymbolGraph + ReferenceResolver + ImplementationFinder를
 * 하나의 facade로 통합한다.
 */

import ts from "typescript";
import { err, isErr, type Result } from "@zipbul/result";
import { gildashError, type GildashError } from "../errors";
import { TscProgram, type TscProgramOptions } from "./tsc-program";
import { TypeCollector } from "./type-collector";
import { SymbolGraph, type SymbolNode } from "./symbol-graph";
import { ReferenceResolver } from "./reference-resolver";
import { ImplementationFinder } from "./implementation-finder";
import type {
  ResolvedType,
  SemanticReference,
  Implementation,
  SemanticModuleInterface,
  SemanticExport,
} from "./types";

// ── DI options ───────────────────────────────────────────────────────────────

export interface SemanticLayerOptions extends TscProgramOptions {
  /** Override TypeCollector (for testing). */
  typeCollector?: TypeCollector;
  /** Override SymbolGraph (for testing). */
  symbolGraph?: SymbolGraph;
  /** Override ReferenceResolver (for testing). */
  referenceResolver?: ReferenceResolver;
  /** Override ImplementationFinder (for testing). */
  implementationFinder?: ImplementationFinder;
}

// ── 선언 식별 헬퍼 ───────────────────────────────────────────────────────────

/** export 키워드가 있는지 확인 */
function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true
  );
}

/** 선언 노드의 kind를 문자열로 분류 */
function classifyDeclKind(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isVariableDeclaration(node)) return "const";
  if (ts.isVariableStatement(node)) return "const";
  return "unknown";
}

// ── SemanticLayer ────────────────────────────────────────────────────────────

export class SemanticLayer {
  readonly #program: TscProgram;
  readonly #typeCollector: TypeCollector;
  readonly #symbolGraph: SymbolGraph;
  readonly #referenceResolver: ReferenceResolver;
  readonly #implementationFinder: ImplementationFinder;
  #isDisposed = false;

  private constructor(
    program: TscProgram,
    typeCollector: TypeCollector,
    symbolGraph: SymbolGraph,
    referenceResolver: ReferenceResolver,
    implementationFinder: ImplementationFinder,
  ) {
    this.#program = program;
    this.#typeCollector = typeCollector;
    this.#symbolGraph = symbolGraph;
    this.#referenceResolver = referenceResolver;
    this.#implementationFinder = implementationFinder;
  }

  /**
   * Create a SemanticLayer from a tsconfig.json path.
   *
   * Internally creates TscProgram and all sub-modules.
   * DI overrides via `options` for testing.
   */
  static create(
    tsconfigPath: string,
    options: SemanticLayerOptions = {},
  ): Result<SemanticLayer, GildashError> {
    const programResult = TscProgram.create(tsconfigPath, {
      readConfigFile: options.readConfigFile,
      resolveNonTrackedFile: options.resolveNonTrackedFile,
    });
    if (isErr(programResult)) return programResult;

    const program = programResult;

    const typeCollector = options.typeCollector ?? new TypeCollector(program);
    const symbolGraph = options.symbolGraph ?? new SymbolGraph(program);
    const referenceResolver = options.referenceResolver ?? new ReferenceResolver(program);
    const implementationFinder = options.implementationFinder ?? new ImplementationFinder(program);

    return new SemanticLayer(
      program,
      typeCollector,
      symbolGraph,
      referenceResolver,
      implementationFinder,
    );
  }

  // ── Read-only state ─────────────────────────────────────────────────────

  get isDisposed(): boolean {
    return this.#isDisposed;
  }

  // ── Type collection ─────────────────────────────────────────────────────

  collectTypeAt(filePath: string, position: number): ResolvedType | null {
    this.#assertNotDisposed();
    return this.#typeCollector.collectAt(filePath, position);
  }

  collectFileTypes(filePath: string): Map<number, ResolvedType> {
    this.#assertNotDisposed();
    return this.#typeCollector.collectFile(filePath);
  }

  // ── Semantic references ─────────────────────────────────────────────────

  findReferences(filePath: string, position: number): SemanticReference[] {
    this.#assertNotDisposed();
    return this.#referenceResolver.findAt(filePath, position);
  }

  // ── Implementations ─────────────────────────────────────────────────────

  findImplementations(filePath: string, position: number): Implementation[] {
    this.#assertNotDisposed();
    return this.#implementationFinder.findAt(filePath, position);
  }

  // ── Symbol graph ────────────────────────────────────────────────────────

  getSymbolNode(filePath: string, position: number): SymbolNode | null {
    this.#assertNotDisposed();
    return this.#symbolGraph.get(filePath, position);
  }

  // ── Module interface ────────────────────────────────────────────────────

  getModuleInterface(filePath: string): SemanticModuleInterface {
    this.#assertNotDisposed();

    const typeMap = this.#typeCollector.collectFile(filePath);
    const exports: SemanticExport[] = [];

    // AST에서 export 선언을 탐색
    const tsProgram = this.#program.getProgram();
    const sourceFile = tsProgram.getSourceFile(filePath);
    if (!sourceFile) return { filePath, exports };

    function visit(node: ts.Node): void {
      // export const/let/var — VariableStatement 레벨에서 export 체크
      if (ts.isVariableStatement(node) && hasExportModifier(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const nameStartPos = decl.name.getStart(sourceFile!);
            const resolvedType = typeMap.get(nameStartPos) ?? null;
            exports.push({
              name: decl.name.text,
              kind: "const",
              resolvedType,
            });
          }
        }
        return; // 자식 노드 재방문 불필요
      }

      // export function / class / interface / type / enum
      if (
        (ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node)) &&
        hasExportModifier(node) &&
        node.name
      ) {
        const nameNode = node.name;
        const nameStartPos = nameNode.getStart(sourceFile!);
        const resolvedType = typeMap.get(nameStartPos) ?? null;
        exports.push({
          name: nameNode.text,
          kind: classifyDeclKind(node),
          resolvedType,
        });
        return;
      }

      ts.forEachChild(node, visit);
    }

    visit(sourceFile);

    return { filePath, exports };
  }

  // ── Incremental update ──────────────────────────────────────────────────

  notifyFileChanged(filePath: string, content: string): void {
    if (this.#isDisposed) return;
    this.#program.notifyFileChanged(filePath, content);
    this.#symbolGraph.invalidate(filePath);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────

  dispose(): void {
    if (this.#isDisposed) return;
    this.#isDisposed = true;
    this.#program.dispose();
    this.#symbolGraph.clear();
  }

  // ── Internal ────────────────────────────────────────────────────────────

  #assertNotDisposed(): void {
    if (this.#isDisposed) {
      throw new Error("SemanticLayer is disposed");
    }
  }
}
