import { describe, expect, it } from "bun:test";
import { isErr } from "@zipbul/result";
import type { GildashError } from "../errors";
import { TscProgram } from "./tsc-program";
import { SymbolGraph } from "./symbol-graph";

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

// ── SymbolGraph ───────────────────────────────────────────────────────────────

describe("SymbolGraph", () => {
  // 1. [HP] class 이름 위치에서 get → SymbolNode.name, members 포함
  it("should return SymbolNode with members when getting class name position", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/hp1.ts";
    const content = "class Foo { bar(): void {} }";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const node = graph.get(filePath, pos(content, "Foo"));

    // Assert
    expect(node).not.toBeNull();
    expect(node!.name).toBe("Foo");
    expect(node!.filePath).toBe(filePath);
    expect(node!.members).toBeDefined();
    expect(node!.members!.some((m) => m.name === "bar")).toBe(true);
  });

  // 2. [HP] interface 이름 위치에서 get → SymbolNode.name, members 포함
  it("should return SymbolNode with members when getting interface name position", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/hp2.ts";
    const content = "interface IFoo { x: string; }";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const node = graph.get(filePath, pos(content, "IFoo"));

    // Assert
    expect(node).not.toBeNull();
    expect(node!.name).toBe("IFoo");
    expect(node!.members).toBeDefined();
    expect(node!.members!.some((m) => m.name === "x")).toBe(true);
  });

  // 3. [HP] namespace 이름 위치에서 get → SymbolNode.name, exports 포함
  it("should return SymbolNode with exports when getting namespace name position", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/hp3.ts";
    const content = "namespace MyNS { export function myFn() {} }";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const node = graph.get(filePath, pos(content, "MyNS"));

    // Assert
    expect(node).not.toBeNull();
    expect(node!.name).toBe("MyNS");
    expect(node!.exports).toBeDefined();
    expect(node!.exports!.some((e) => e.name === "myFn")).toBe(true);
  });

  // 4. [HP] enum 이름 위치에서 get → SymbolNode.name, members(enum values) 포함
  it("should return SymbolNode with enum members when getting enum name position", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/hp4.ts";
    const content = "enum Color { Red, Green, Blue }";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const node = graph.get(filePath, pos(content, "Color"));

    // Assert
    expect(node).not.toBeNull();
    expect(node!.name).toBe("Color");
    expect(node!.members).toBeDefined();
    expect(node!.members!.some((m) => m.name === "Red")).toBe(true);
    expect(node!.members!.some((m) => m.name === "Green")).toBe(true);
  });

  // 5. [HP] function 이름 위치에서 get → SymbolNode.name, members=undefined
  it("should return SymbolNode without members when getting function name position", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/hp5.ts";
    const content = "function myFunc() {}";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const node = graph.get(filePath, pos(content, "myFunc"));

    // Assert
    expect(node).not.toBeNull();
    expect(node!.name).toBe("myFunc");
    expect(node!.members).toBeUndefined();
    expect(node!.exports).toBeUndefined();
  });

  // 6. [HP] variable 선언 이름에서 get → SymbolNode.name, members=undefined
  it("should return SymbolNode without members when getting variable declaration name", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/hp6.ts";
    const content = "const myVar = 42;";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const node = graph.get(filePath, pos(content, "myVar"));

    // Assert
    expect(node).not.toBeNull();
    expect(node!.name).toBe("myVar");
    expect(node!.members).toBeUndefined();
  });

  // 7. [HP] class method 이름에서 get → method SymbolNode 반환
  it("should return method SymbolNode when getting class method name position", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/hp7.ts";
    const content = "class C { myMethod(): string { return ''; } }";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const node = graph.get(filePath, pos(content, "myMethod"));

    // Assert
    expect(node).not.toBeNull();
    expect(node!.name).toBe("myMethod");
  });

  // 8. [HP] namespace export function에서 get → function SymbolNode.parent.name=NS
  it("should return SymbolNode with parent NS when getting namespace export function name", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/hp8.ts";
    const content = "namespace NS { export function exportedFn() {} }";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const node = graph.get(filePath, pos(content, "exportedFn"));

    // Assert
    expect(node).not.toBeNull();
    expect(node!.name).toBe("exportedFn");
    expect(node!.parent).toBeDefined();
    expect(node!.parent!.name).toBe("NS");
  });

  // 9. [NE] 존재하지 않는 파일 경로 → null
  it("should return null when file path has never been added to program", () => {
    // Arrange
    const prog = makeProg();
    const graph = new SymbolGraph(prog);

    // Act
    const node = graph.get("/project/src/nonexistent.ts", 0);

    // Assert
    expect(node).toBeNull();
  });

  // 10. [NE] 공백/whitespace 위치 → null
  it("should return null when position is on a whitespace character", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ne2.ts";
    const content = "const x = 1;";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const node = graph.get(filePath, pos(content, " "));

    // Assert
    expect(node).toBeNull();
  });

  // 11. [NE] keyword 위치 (`class` 키워드) → null
  it("should return null when position is on a keyword token", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ne3.ts";
    const content = "class KwClass {}";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act: position 0 is 'c' of 'class' keyword
    const node = graph.get(filePath, 0);

    // Assert
    expect(node).toBeNull();
  });

  // 12. [NE] punctuation 위치 (`{`) → null
  it("should return null when position is on a punctuation token", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ne4.ts";
    const content = "class PuClass {}";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act: '{' open brace
    const node = graph.get(filePath, pos(content, "{"));

    // Assert
    expect(node).toBeNull();
  });

  // 13. [NE] 음수 position → null
  it("should return null when position is negative", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ne5.ts";
    const content = "const z = 0;";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const node = graph.get(filePath, -1);

    // Assert
    expect(node).toBeNull();
  });

  // 14. [NE] disposed TscProgram → null
  it("should return null when underlying TscProgram is disposed", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ne6.ts";
    const content = "const alive = 1;";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    prog.dispose();
    const node = graph.get(filePath, pos(content, "alive"));

    // Assert
    expect(node).toBeNull();
  });

  // 15. [ED] capacity=1 → get(A) 후 get(B)가 A를 evict; get(A) 재계산
  it("should evict oldest entry and recompute when capacity is 1", () => {
    // Arrange
    const prog = makeProg();
    const fileA = "/project/src/ed1a.ts";
    const fileB = "/project/src/ed1b.ts";
    const contentA = "class Alpha {}";
    const contentB = "class Beta {}";
    prog.notifyFileChanged(fileA, contentA);
    prog.notifyFileChanged(fileB, contentB);
    const graph = new SymbolGraph(prog, 1);

    // Act
    const firstA = graph.get(fileA, pos(contentA, "Alpha"));
    graph.get(fileB, pos(contentB, "Beta")); // evicts Alpha
    const secondA = graph.get(fileA, pos(contentA, "Alpha")); // recomputed

    // Assert
    expect(firstA).not.toBeNull();
    expect(secondA).not.toBeNull();
    expect(secondA!.name).toBe("Alpha");
    // recomputed → different object reference (evicted and re-fetched)
    expect(secondA).not.toBe(firstA);
  });

  // 16. [ED] identifier 첫 문자 위치 → valid SymbolNode 반환
  it("should return valid SymbolNode when position is at the first character of an identifier", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ed2.ts";
    const content = "class EdgeA {}";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act: 'E' of 'EdgeA' is the first character
    const node = graph.get(filePath, pos(content, "EdgeA"));

    // Assert
    expect(node).not.toBeNull();
    expect(node!.name).toBe("EdgeA");
  });

  // 17. [ED] identifier 마지막 문자 위치 → valid SymbolNode 반환
  it("should return valid SymbolNode when position is at the last character of an identifier", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ed3.ts";
    const content = "class EdgeB {}";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act: last 'B' of 'EdgeB'
    const startIdx = pos(content, "EdgeB");
    const lastIdx = startIdx + "EdgeB".length - 1;
    const node = graph.get(filePath, lastIdx);

    // Assert
    expect(node).not.toBeNull();
    expect(node!.name).toBe("EdgeB");
  });

  // 18. [ED] empty class `class C {}` → members undefined 또는 empty array
  it("should return SymbolNode with no members when class has no members", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/ed4.ts";
    const content = "class EmptyC {}";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const node = graph.get(filePath, pos(content, "EmptyC"));

    // Assert
    expect(node).not.toBeNull();
    expect(node!.name).toBe("EmptyC");
    // members is either undefined or empty array
    expect(!node!.members || node!.members.length === 0).toBe(true);
  });

  // 19. [CO] namespace with class + function exports → exports 배열에 두 항목
  it("should return exports with both class and function when namespace exports both", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/co1.ts";
    const content =
      "namespace MultiNS { export class ExClass {} export function exFn() {} }";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const node = graph.get(filePath, pos(content, "MultiNS"));

    // Assert
    expect(node).not.toBeNull();
    expect(node!.exports).toBeDefined();
    expect(node!.exports!.some((e) => e.name === "ExClass")).toBe(true);
    expect(node!.exports!.some((e) => e.name === "exFn")).toBe(true);
  });

  // 20. [CO] get(A) → cache; invalidate(A's file) → get(A) → fresh compute (cache miss)
  it("should recompute after invalidation when the file was previously cached", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/co2.ts";
    const content = "class CoA {}";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const first = graph.get(filePath, pos(content, "CoA"));
    graph.invalidate(filePath);
    const second = graph.get(filePath, pos(content, "CoA"));

    // Assert
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.name).toBe("CoA");
    expect(second).not.toBe(first); // cache missed → new object
  });

  // 21. [CO] get(A) → cache; clear() → get(A) → fresh compute
  it("should recompute after clear when entry was previously cached", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/co3.ts";
    const content = "class CoB {}";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const first = graph.get(filePath, pos(content, "CoB"));
    graph.clear();
    const second = graph.get(filePath, pos(content, "CoB"));

    // Assert
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second!.name).toBe("CoB");
    expect(second).not.toBe(first); // cache cleared → new object
  });

  // 22. [CO] capacity=2: get(A),get(B),get(A)=캐시 히트, get(C)=B evict
  it("should evict least recently used entry when capacity=2 and a new key is added after access", () => {
    // Arrange
    const prog = makeProg();
    const fileA = "/project/src/co4a.ts";
    const fileB = "/project/src/co4b.ts";
    const fileC = "/project/src/co4c.ts";
    const contentA = "class LruA {}";
    const contentB = "class LruB {}";
    const contentC = "class LruC {}";
    prog.notifyFileChanged(fileA, contentA);
    prog.notifyFileChanged(fileB, contentB);
    prog.notifyFileChanged(fileC, contentC);
    const graph = new SymbolGraph(prog, 2);

    // Act
    graph.get(fileA, pos(contentA, "LruA")); // cache: [A]
    const firstB = graph.get(fileB, pos(contentB, "LruB")); // cache: [A, B]
    graph.get(fileA, pos(contentA, "LruA")); // cache: [B, A] (A is now most recent)
    graph.get(fileC, pos(contentC, "LruC")); // evicts B → cache: [A, C]
    const secondB = graph.get(fileB, pos(contentB, "LruB")); // recomputed → new object

    // Assert
    expect(firstB).not.toBeNull();
    expect(secondB).not.toBeNull();
    expect(secondB!.name).toBe("LruB");
    expect(secondB).not.toBe(firstB); // B was evicted and recomputed
  });

  // 23. [CO] multiple files cached; invalidate(file1) → file2 entries intact
  it("should preserve other file entries when invalidating a specific file", () => {
    // Arrange
    const prog = makeProg();
    const file1 = "/project/src/co5a.ts";
    const file2 = "/project/src/co5b.ts";
    const content1 = "class File1Class {}";
    const content2 = "class File2Class {}";
    prog.notifyFileChanged(file1, content1);
    prog.notifyFileChanged(file2, content2);
    const graph = new SymbolGraph(prog, 100);

    // Act
    graph.get(file1, pos(content1, "File1Class"));
    const cachedFile2 = graph.get(file2, pos(content2, "File2Class"));
    graph.invalidate(file1);
    const afterInvalidate = graph.get(file2, pos(content2, "File2Class"));

    // Assert
    expect(cachedFile2).not.toBeNull();
    expect(afterInvalidate).not.toBeNull();
    expect(afterInvalidate).toBe(cachedFile2); // file2 still cached (same object)
  });

  // 24. [ST] construct → get → 두 번째 같은 키 get → cache hit (same object)
  it("should return cached object on second get with same key", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/st1.ts";
    const content = "class StA {}";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const first = graph.get(filePath, pos(content, "StA"));
    const second = graph.get(filePath, pos(content, "StA"));

    // Assert
    expect(first).not.toBeNull();
    expect(second).toBe(first); // exact same object reference (cache hit)
  });

  // 25. [ST] get → invalidate → get → fresh SymbolNode (not same object)
  it("should return new SymbolNode after invalidate when same position is requested again", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/st2.ts";
    const content = "class StB {}";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const before = graph.get(filePath, pos(content, "StB"));
    graph.invalidate(filePath);
    const after = graph.get(filePath, pos(content, "StB"));

    // Assert
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before); // different object (cache was cleared)
  });

  // 26. [ST] get(A) → clear() → get(A) → fresh SymbolNode
  it("should return new SymbolNode after clear when same position is requested again", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/st3.ts";
    const content = "class StC {}";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const before = graph.get(filePath, pos(content, "StC"));
    graph.clear();
    const after = graph.get(filePath, pos(content, "StC"));

    // Assert
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(after).not.toBe(before); // different object (cache was cleared)
  });

  // 27. [ST] new SymbolGraph(program, capacity) → 정상 생성, capacity 적용
  it("should construct without error when capacity is provided", () => {
    // Arrange
    const prog = makeProg();

    // Act
    const graph = new SymbolGraph(prog, 50);

    // Assert — no throw; get still works
    const filePath = "/project/src/st4.ts";
    const content = "class StD {}";
    prog.notifyFileChanged(filePath, content);
    const node = graph.get(filePath, pos(content, "StD"));
    expect(node).not.toBeNull();
    expect(node!.name).toBe("StD");
  });

  // 28. [ID] 같은 key 두 번 get → 동일한 SymbolNode.name (캐시 hit 동일 결과)
  it("should return identical name on second get when key is the same", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/id1.ts";
    const content = "const idVar = 'hello';";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const a = graph.get(filePath, pos(content, "idVar"));
    const b = graph.get(filePath, pos(content, "idVar"));

    // Assert
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.name).toBe(b!.name);
    expect(a).toBe(b);
  });

  // 29. [ID] SymbolNode.position이 node.getStart()와 일치
  it("should set SymbolNode position to the declaration start offset", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/id2.ts";
    // "class IdCls {}" → 'IdCls' starts at index 6
    const content = "class IdCls {}";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const node = graph.get(filePath, pos(content, "IdCls"));

    // Assert
    expect(node).not.toBeNull();
    expect(node!.position).toBe(pos(content, "IdCls")); // equals getStart() of the identifier
  });

  // 30. [OR] enum member의 parent.name이 enum 이름과 일치
  it("should set parent to the enum symbol when getting an enum member position", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/or1.ts";
    const content = "enum Fruit { Apple, Banana }";
    prog.notifyFileChanged(filePath, content);
    const graph = new SymbolGraph(prog);

    // Act
    const memberNode = graph.get(filePath, pos(content, "Apple"));

    // Assert
    expect(memberNode).not.toBeNull();
    expect(memberNode!.name).toBe("Apple");
    expect(memberNode!.parent).toBeDefined();
    expect(memberNode!.parent!.name).toBe("Fruit");
  });
});
