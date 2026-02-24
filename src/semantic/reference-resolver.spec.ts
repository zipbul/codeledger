import { describe, expect, it } from "bun:test";
import { isErr } from "@zipbul/result";
import type { GildashError } from "../errors";
import { TscProgram } from "./tsc-program";
import { ReferenceResolver } from "./reference-resolver";

// ── 공통 픽스처 ──────────────────────────────────────────────────────────────

const TSCONFIG_PATH = "/project/tsconfig.json";
const VALID_TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: "ES2022", module: "NodeNext" },
});

function makeProg(): TscProgram {
  const result = TscProgram.create(TSCONFIG_PATH, {
    readConfigFile: (p) => (p === TSCONFIG_PATH ? VALID_TSCONFIG : undefined),
    resolveNonTrackedFile: (p) =>
      p.includes("lib.") && p.endsWith(".d.ts") ? "// fake lib\nexport {};\n" : undefined,
  });
  if (isErr<GildashError>(result)) throw new Error(`setup failed: ${result.data.message}`);
  return result;
}

/** Position of first occurrence of `marker` in `content`. */
function pos(content: string, marker: string): number {
  const idx = content.indexOf(marker);
  if (idx === -1) throw new Error(`marker "${marker}" not found in content`);
  return idx;
}

// ── ReferenceResolver ─────────────────────────────────────────────────────────

describe("ReferenceResolver", () => {
  // 1. [HP] 변수 선언 + 사용 → 참조 2개 (definition + read)
  it("should return definition and read references for a variable declaration and usage", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/hp1.ts";
    const content = "const x = 1;\nconst y = x;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, pos(content, "x"));

    // Assert
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(refs.some((r) => r.isDefinition)).toBe(true);
    expect(refs.some((r) => !r.isDefinition && !r.isWrite)).toBe(true);
  });

  // 2. [HP] 함수 선언 + 호출 → 참조 2개
  it("should return references for function declaration and call site", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/hp2.ts";
    const content = "function greet() {}\ngreet();";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, pos(content, "greet"));

    // Assert
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(refs.some((r) => r.isDefinition)).toBe(true);
  });

  // 3. [HP] class 이름 선언 + new → 참조 2개
  it("should return references for class declaration and new expression", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/hp3.ts";
    const content = "class Dog {}\nconst d = new Dog();";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, pos(content, "Dog"));

    // Assert
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(refs.some((r) => r.isDefinition)).toBe(true);
  });

  // 4. [HP] 변수 재할당 → isWrite=true
  it("should mark reassignment reference as isWrite true", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/hp4.ts";
    const content = "let v = 1;\nv = 2;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, pos(content, "v"));

    // Assert
    const writeRefs = refs.filter((r) => r.isWrite && !r.isDefinition);
    expect(writeRefs.length).toBeGreaterThanOrEqual(1);
  });

  // 5. [HP] 변수 읽기 → isWrite=false, isDefinition=false
  it("should mark read-only reference as isWrite false and isDefinition false", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/hp5.ts";
    const content = "const r = 10;\nconst s = r + 1;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, pos(content, "r"));

    // Assert
    const readRefs = refs.filter((r) => !r.isDefinition && !r.isWrite);
    expect(readRefs.length).toBeGreaterThanOrEqual(1);
  });

  // 6. [HP] cross-file: export → import → usage
  it("should return cross-file references for export + import + usage", () => {
    // Arrange
    const prog = makeProg();
    const fileA = "/project/src/hp6a.ts";
    const fileB = "/project/src/hp6b.ts";
    const contentA = "export const shared = 42;";
    const contentB = 'import { shared } from "./hp6a";\nconst v = shared;';
    prog.notifyFileChanged(fileA, contentA);
    prog.notifyFileChanged(fileB, contentB);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(fileA, pos(contentA, "shared"));

    // Assert
    expect(refs.length).toBeGreaterThanOrEqual(2);
    const fileARef = refs.filter((r) => r.filePath === fileA);
    const fileBRef = refs.filter((r) => r.filePath === fileB);
    expect(fileARef.length).toBeGreaterThanOrEqual(1);
    expect(fileBRef.length).toBeGreaterThanOrEqual(1);
  });

  // 7. [HP] enum member → 선언 + Enum.Member 사용
  it("should return references for enum member declaration and usage", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/hp7.ts";
    const content = "enum Dir { Up, Down }\nconst d = Dir.Up;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, pos(content, "Up"));

    // Assert
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  // 8. [HP] interface property → 선언 + 타입 사용
  it("should return references for interface property declaration and usage", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/hp8.ts";
    const content =
      "interface Cfg { port: number }\nconst c: Cfg = { port: 8080 };";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, pos(content, "port"));

    // Assert
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  // 9. [NE] 존재하지 않는 파일 → []
  it("should return empty array when file does not exist in program", () => {
    // Arrange
    const prog = makeProg();
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt("/project/src/nonexistent.ts", 0);

    // Assert
    expect(refs).toEqual([]);
  });

  // 10. [NE] 공백 위치 → []
  it("should return empty array when position is on whitespace", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ne2.ts";
    const content = "const a = 1;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, pos(content, " "));

    // Assert
    expect(refs).toEqual([]);
  });

  // 11. [NE] keyword 위치 → []
  it("should return empty array when position is on a keyword", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ne3.ts";
    const content = "class KwTest {}";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act: position 0 is 'c' of 'class'
    const refs = resolver.findAt(filePath, 0);

    // Assert
    expect(refs).toEqual([]);
  });

  // 12. [NE] punctuation 위치 → []
  it("should return empty array when position is on punctuation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ne4.ts";
    const content = "class PuTest {}";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, pos(content, "{"));

    // Assert
    expect(refs).toEqual([]);
  });

  // 13. [NE] 음수 position → []
  it("should return empty array when position is negative", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ne5.ts";
    const content = "const z = 0;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, -1);

    // Assert
    expect(refs).toEqual([]);
  });

  // 14. [NE] disposed program → []
  it("should return empty array when program is disposed", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ne6.ts";
    const content = "const alive = 1;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    prog.dispose();
    const refs = resolver.findAt(filePath, pos(content, "alive"));

    // Assert
    expect(refs).toEqual([]);
  });

  // 15. [ED] 선언만 있고 사용 없음 → 참조 1개 (definition만)
  it("should return only the definition reference when symbol is declared but never used", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ed1.ts";
    const content = "const lonely = 42;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, pos(content, "lonely"));

    // Assert
    expect(refs.length).toBe(1);
    expect(refs[0]!.isDefinition).toBe(true);
  });

  // 16. [ED] identifier 첫 문자 위치 → valid 참조
  it("should return references when position is at the first character of an identifier", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ed2.ts";
    const content = "const edgeFirst = 1;\nconst u = edgeFirst;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, pos(content, "edgeFirst"));

    // Assert
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  // 17. [ED] identifier 마지막 문자 위치 → valid 참조
  it("should return references when position is at the last character of an identifier", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ed3.ts";
    const content = "const edgeLast = 1;\nconst u = edgeLast;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const startIdx = pos(content, "edgeLast");
    const lastIdx = startIdx + "edgeLast".length - 1;
    const refs = resolver.findAt(filePath, lastIdx);

    // Assert
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  // 18. [ED] 같은 줄 x+x+x → 참조 수 확인
  it("should return multiple references when same variable appears multiple times on one line", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ed4.ts";
    const content = "const multi = 1;\nconst sum = multi + multi + multi;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, pos(content, "multi"));

    // Assert
    // 1 definition + 3 usages = 4
    expect(refs.length).toBeGreaterThanOrEqual(4);
  });

  // 19. [CO] cross-file isDefinition + isWrite 조합
  it("should correctly identify isDefinition and isWrite across files", () => {
    // Arrange
    const prog = makeProg();
    const fileA = "/project/src/co1a.ts";
    const fileB = "/project/src/co1b.ts";
    const contentA = "export let counter = 0;";
    const contentB = 'import { counter } from "./co1a";\ncounter = 5;';
    prog.notifyFileChanged(fileA, contentA);
    prog.notifyFileChanged(fileB, contentB);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(fileA, pos(contentA, "counter"));

    // Assert
    expect(refs.some((r) => r.isDefinition)).toBe(true);
    // cross-file write on counter = 5
    const crossWrite = refs.filter(
      (r) => r.filePath === fileB && r.isWrite,
    );
    expect(crossWrite.length).toBeGreaterThanOrEqual(1);
  });

  // 20. [CO] shadowed variable → 독립 참조
  it("should return independent references for shadowed variables in different scopes", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/co2.ts";
    const content = [
      "const shadow = 1;",
      "function f() { const shadow = 2; const y = shadow; }",
      "const z = shadow;",
    ].join("\n");
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act — outer 'shadow' (line 1)
    const outerRefs = resolver.findAt(filePath, pos(content, "shadow"));

    // Assert — outer shadow references: declaration + usage in line 3
    // Should NOT include the inner shadow in f()
    const outerPositions = outerRefs.map((r) => r.position);
    const innerShadowPos = content.indexOf("shadow", content.indexOf("{ const ") + 8);
    expect(outerPositions).not.toContain(innerShadowPos);
  });

  // 21. [CO] class method 참조: 선언 + 호출 + cross-file
  it("should return class method references including cross-file calls", () => {
    // Arrange
    const prog = makeProg();
    const fileA = "/project/src/co3a.ts";
    const fileB = "/project/src/co3b.ts";
    const contentA = "export class Svc { run(): void {} }";
    const contentB =
      'import { Svc } from "./co3a";\nconst s = new Svc();\ns.run();';
    prog.notifyFileChanged(fileA, contentA);
    prog.notifyFileChanged(fileB, contentB);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(fileA, pos(contentA, "run"));

    // Assert
    expect(refs.length).toBeGreaterThanOrEqual(2);
    expect(refs.some((r) => r.filePath === fileA)).toBe(true);
    expect(refs.some((r) => r.filePath === fileB)).toBe(true);
  });

  // 22. [CO] re-export chain: A export → B re-export → C import
  it("should include references through re-export chain", () => {
    // Arrange
    const prog = makeProg();
    const fileA = "/project/src/co4a.ts";
    const fileB = "/project/src/co4b.ts";
    const fileC = "/project/src/co4c.ts";
    const contentA = "export const origin = 99;";
    const contentB = 'export { origin } from "./co4a";';
    const contentC =
      'import { origin } from "./co4b";\nconst v = origin;';
    prog.notifyFileChanged(fileA, contentA);
    prog.notifyFileChanged(fileB, contentB);
    prog.notifyFileChanged(fileC, contentC);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(fileA, pos(contentA, "origin"));

    // Assert — references span across all three files
    expect(refs.length).toBeGreaterThanOrEqual(3);
    const files = new Set(refs.map((r) => r.filePath));
    expect(files.size).toBeGreaterThanOrEqual(2);
  });

  // 23. [CO] let x=1; x=2; log(x) → definition(write) + write + read 3종
  it("should correctly classify definition write and reassignment write and read reference", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/co5.ts";
    const content = "let val = 1;\nval = 2;\nconst out = val;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, pos(content, "val"));

    // Assert
    expect(refs.length).toBeGreaterThanOrEqual(3);
    // definition
    expect(refs.some((r) => r.isDefinition)).toBe(true);
    // reassignment write (not definition)
    expect(refs.some((r) => r.isWrite && !r.isDefinition)).toBe(true);
    // read
    expect(refs.some((r) => !r.isWrite && !r.isDefinition)).toBe(true);
  });

  // 24. [ST] findAt 같은 위치 2번 → 동일 결과
  it("should return identical results when findAt is called twice on the same position", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/st1.ts";
    const content = "const stable = 10;\nconst u = stable;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const first = resolver.findAt(filePath, pos(content, "stable"));
    const second = resolver.findAt(filePath, pos(content, "stable"));

    // Assert
    expect(first.length).toBe(second.length);
    for (let i = 0; i < first.length; i++) {
      expect(first[i]!.filePath).toBe(second[i]!.filePath);
      expect(first[i]!.position).toBe(second[i]!.position);
      expect(first[i]!.isDefinition).toBe(second[i]!.isDefinition);
      expect(first[i]!.isWrite).toBe(second[i]!.isWrite);
    }
  });

  // 25. [ST] notifyFileChanged → findAt → 새 내용 기준
  it("should reflect updated references after file content change", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/st2.ts";
    const content1 = "const fresh = 1;";
    prog.notifyFileChanged(filePath, content1);
    const resolver = new ReferenceResolver(prog);

    // Act — before: only definition
    const refsBefore = resolver.findAt(filePath, pos(content1, "fresh"));

    // Add a usage
    const content2 = "const fresh = 1;\nconst u = fresh;";
    prog.notifyFileChanged(filePath, content2);
    const refsAfter = resolver.findAt(filePath, pos(content2, "fresh"));

    // Assert
    expect(refsAfter.length).toBeGreaterThan(refsBefore.length);
  });

  // 26. [ST] findAt → dispose → findAt → []
  it("should return empty array after program is disposed even if previously returned results", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/st3.ts";
    const content = "const mortal = 1;\nconst u = mortal;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const before = resolver.findAt(filePath, pos(content, "mortal"));
    prog.dispose();
    const after = resolver.findAt(filePath, pos(content, "mortal"));

    // Assert
    expect(before.length).toBeGreaterThanOrEqual(2);
    expect(after).toEqual([]);
  });

  // 27. [ST] construct → 파일 추가 후 findAt → valid
  it("should return references after adding a file to the program", () => {
    // Arrange
    const prog = makeProg();
    const resolver = new ReferenceResolver(prog);
    const filePath = "/project/src/st4.ts";
    const content = "const late = 1;\nconst u = late;";

    // Act — add file after constructing resolver
    prog.notifyFileChanged(filePath, content);
    const refs = resolver.findAt(filePath, pos(content, "late"));

    // Assert
    expect(refs.length).toBeGreaterThanOrEqual(2);
  });

  // 28. [ID] line=1-based, column=0-based 정확도
  it("should set line as 1-based and column as 0-based in semantic references", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/id1.ts";
    // 'abc' is on line 2, column 6 (0-based): "const abc = 1;"
    const content = "// header\nconst abc = 1;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, pos(content, "abc"));

    // Assert
    const defRef = refs.find((r) => r.isDefinition);
    expect(defRef).toBeDefined();
    expect(defRef!.line).toBe(2); // 1-based: line 2
    expect(defRef!.column).toBe(6); // 0-based: "const " = 6 chars
  });

  // 29. [ID] isDefinition===true 정확히 1개
  it("should have exactly one definition reference for a single-declaration symbol", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/id2.ts";
    const content = "const single = 1;\nconst a = single;\nconst b = single;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const refs = resolver.findAt(filePath, pos(content, "single"));

    // Assert
    const defs = refs.filter((r) => r.isDefinition);
    expect(defs.length).toBe(1);
  });

  // 30. [OR] 같은 파일 참조 결과 동일 순서
  it("should return references in a stable order across invocations", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/or1.ts";
    const content = "const ord = 1;\nconst a = ord;\nconst b = ord;\nconst c = ord;";
    prog.notifyFileChanged(filePath, content);
    const resolver = new ReferenceResolver(prog);

    // Act
    const run1 = resolver.findAt(filePath, pos(content, "ord"));
    const run2 = resolver.findAt(filePath, pos(content, "ord"));

    // Assert — same order
    expect(run1.length).toBe(run2.length);
    for (let i = 0; i < run1.length; i++) {
      expect(run1[i]!.position).toBe(run2[i]!.position);
    }
  });
});
