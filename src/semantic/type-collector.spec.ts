import { describe, expect, it } from "bun:test";
import { isErr } from "@zipbul/result";
import type { GildashError } from "../errors";
import { TscProgram } from "./tsc-program";
import { TypeCollector } from "./type-collector";

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

// ── TypeCollector ─────────────────────────────────────────────────────────────

describe("TypeCollector", () => {
  // 1. [HP] `const x: string` → text="string", isUnion=false, isGeneric=false
  it("should return string type when symbol has string annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/a.ts";
    const content = "const x: string = 'hello';";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toBe("string");
    expect(result!.isUnion).toBe(false);
    expect(result!.isIntersection).toBe(false);
    expect(result!.isGeneric).toBe(false);
  });

  // 2. [HP] `const x: any` → text="any"
  it("should return any type when symbol has any annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/b.ts";
    const content = "const x: any = 1;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toBe("any");
  });

  // 3. [HP] `const x: never` → text="never"
  it("should return never type when symbol has never annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/c.ts";
    const content = "declare const x: never;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toBe("never");
    expect(result!.isUnion).toBe(false);
    expect(result!.isGeneric).toBe(false);
  });

  // 4. [HP] `const x: string | undefined` → isUnion=true, members.length=2
  it("should return union type with two members when symbol has string or undefined annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/d.ts";
    const content = "const x: string | undefined = undefined;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.isUnion).toBe(true);
    expect(result!.members).toBeDefined();
    expect(result!.members!.length).toBe(2);
    const texts = result!.members!.map((m) => m.text);
    expect(texts).toContain("string");
    expect(texts).toContain("undefined");
  });

  // 5. [HP] `const x: A & B` → isIntersection=true, members.length=2
  it("should return intersection type with two members when symbol uses intersection annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/e.ts";
    const content = [
      "interface A { a: string }",
      "interface B { b: number }",
      "declare const x: A & B;",
    ].join("\n");
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, content.lastIndexOf("x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.isIntersection).toBe(true);
    expect(result!.members).toBeDefined();
    expect(result!.members!.length).toBe(2);
  });

  // 6. [HP] 인라인 generic 클래스 → isGeneric=true, typeArguments[0].text="number"
  it("should return generic type with number type argument when symbol has Promise<number> annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/f.ts";
    const content = "declare class Async<T> { v: T }; declare const myConst: Async<number>;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "myConst"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.isGeneric).toBe(true);
    expect(result!.typeArguments).toBeDefined();
    expect(result!.typeArguments!.length).toBeGreaterThanOrEqual(1);
    expect(result!.typeArguments![0]!.text).toBe("number");
  });

  // 7. [HP] `function f(): void {}` → 함수 타입 text 반환
  it("should return function type text when symbol is a function declaration", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/g.ts";
    const content = "function greet(): void {}";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "greet"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toContain("void");
  });

  // 8. [HP] `interface Foo { x: string }` → 인터페이스 타입 수집
  it("should return interface type when symbol is an interface declaration", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/h.ts";
    const content = "interface Foo { x: string }";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "Foo"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toContain("Foo");
  });

  // 9. [HP] `42 as const` 리터럴 타입 → text가 숫자 리터럴 포함
  it("should return numeric literal type when symbol uses as const assertion", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/i.ts";
    const content = "const x = 42 as const;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toContain("42");
  });

  // 10. [HP] collectFile 정상 파일 → Map size > 0
  it("should return non-empty map when collecting all symbols from a file with declarations", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/j.ts";
    const content = [
      "const a: string = 'a';",
      "const b: number = 1;",
      "const c: boolean = true;",
    ].join("\n");
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectFile(filePath);

    // Assert
    expect(result.size).toBeGreaterThan(0);
  });

  // 11. [HP] 인라인 2-param generic 클래스 → typeArguments.length=2
  it("should return two type arguments when symbol has Map<string, number> annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/k.ts";
    const content = "declare class Pair<K, V> { k: K; v: V }; declare const myConst: Pair<string, number>;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "myConst"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.isGeneric).toBe(true);
    expect(result!.typeArguments).toBeDefined();
    expect(result!.typeArguments!.length).toBe(2);
    expect(result!.typeArguments![0]!.text).toBe("string");
    expect(result!.typeArguments![1]!.text).toBe("number");
  });

  // 12. [NE] 존재하지 않는 filePath → null
  it("should return null when filePath does not exist in tracked files", () => {
    // Arrange
    const prog = makeProg();
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt("/project/src/nonexistent.ts", 0);

    // Assert
    expect(result).toBeNull();
  });

  // 13. [NE] position=-1 음수 → null
  it("should return null when position is negative", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/l.ts";
    prog.notifyFileChanged(filePath, "const x: string = 'a';");
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, -1);

    // Assert
    expect(result).toBeNull();
  });

  // 14. [NE] position > 파일 길이 → null
  it("should return null when position exceeds file length", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/m.ts";
    const content = "const x: string = 'a';";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, content.length + 100);

    // Assert
    expect(result).toBeNull();
  });

  // 15. [NE] 파일 있지만 공백 위치 → null
  it("should return null when position points to whitespace", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/n.ts";
    const content = "const x: string = 'a';";
    // position 5 is the space between 'const' and 'x'
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, 5);

    // Assert
    expect(result).toBeNull();
  });

  // 16. [NE] 파일 있지만 구두점(;) 위치 → null
  it("should return null when position points to semicolon punctuation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/o.ts";
    const content = "const x: string = 'a';";
    // last char is ';'
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, content.length - 1);

    // Assert
    expect(result).toBeNull();
  });

  // 17. [NE] 문법 오류 파일의 유효하지 않은 위치 → null
  it("should return null when file has syntax error and position has no valid symbol", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/p.ts";
    const content = "const = 'broken';";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act — position 6 points to '=' operator, no symbol
    const result = collector.collectAt(filePath, 6);

    // Assert
    expect(result).toBeNull();
  });

  // 18. [NE] disposed TscProgram → throw
  it("should throw when TscProgram has been disposed", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/q.ts";
    prog.notifyFileChanged(filePath, "const x: string = 'a';");
    prog.dispose();
    const collector = new TypeCollector(prog);

    // Act & Assert
    expect(() => collector.collectAt(filePath, 6)).toThrow();
  });

  // 19. [NE] collectFile 존재하지 않는 파일 → 빈 Map
  it("should return empty map when collectFile is given a nonexistent file path", () => {
    // Arrange
    const prog = makeProg();
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectFile("/project/src/ghost.ts");

    // Assert
    expect(result.size).toBe(0);
  });

  // 20. [ED] position이 identifier 첫 문자 → valid type
  it("should return valid type when position points to first character of identifier", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/r.ts";
    const content = "const myVar: number = 10;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);
    const firstChar = content.indexOf("myVar"); // first char of identifier

    // Act
    const result = collector.collectAt(filePath, firstChar);

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toBe("number");
  });

  // 21. [ED] position이 identifier 마지막 문자 → valid type
  it("should return valid type when position points to last character of identifier", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/s.ts";
    const content = "const myVar: number = 10;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);
    const lastChar = content.indexOf("myVar") + "myVar".length - 1; // last char of identifier

    // Act
    const result = collector.collectAt(filePath, lastChar);

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toBe("number");
  });

  // 22. [ED] `const x = {}` 빈 object literal → `{}` 타입
  it("should return empty object type when symbol is initialized with empty object literal", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/t.ts";
    const content = "const x = {};";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toContain("{}");
  });

  // 23. [CO] `string | Wrap<number>` → isUnion=true, members 중 하나가 isGeneric=true
  it("should return union type where one member is generic when symbol has string or Promise<number> annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/u.ts";
    const content = "declare class Wrap<T> { v: T }; declare const myConst: string | Wrap<number>;";
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "myConst"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.isUnion).toBe(true);
    expect(result!.members).toBeDefined();
    const hasGenericMember = result!.members!.some((m) => m.isGeneric && m.typeArguments !== undefined);
    expect(hasGenericMember).toBe(true);
  });

  // 24. [CO] `(A & B) | C` → union members 중 하나가 isIntersection=true
  it("should return union with an intersection member when symbol uses (A and B) or C annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/v.ts";
    const content = [
      "interface A { a: string }",
      "interface B { b: number }",
      "interface C { c: boolean }",
      "declare const x: (A & B) | C;",
    ].join("\n");
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, content.lastIndexOf("x"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.isUnion).toBe(true);
    expect(result!.members).toBeDefined();
    const hasIntersectionMember = result!.members!.some((m) => m.isIntersection);
    expect(hasIntersectionMember).toBe(true);
  });

  // 25. [CO] 3단 중첩 generic → typeArguments 재귀 정상
  it("should return deeply nested generic type arguments when symbol has three-level generic annotation", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/w.ts";
    const content = [
      "declare class Box<T> { v: T }",
      "declare class List<T> { items: T }",
      "declare class Dict<K, V> { k: K; v: V }",
      "declare const myConst: Dict<string, List<Box<number>>>;",
    ].join(" ");
    prog.notifyFileChanged(filePath, content);
    const collector = new TypeCollector(prog);

    // Act
    const result = collector.collectAt(filePath, pos(content, "myConst"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.isGeneric).toBe(true);
    expect(result!.typeArguments).toBeDefined();
    expect(result!.typeArguments!.length).toBe(2);
    // second type arg is List<Box<number>>
    const listArg = result!.typeArguments![1]!;
    expect(listArg.isGeneric).toBe(true);
    expect(listArg.typeArguments).toBeDefined();
    // inner Box<number>
    const boxArg = listArg.typeArguments![0]!;
    expect(boxArg.isGeneric).toBe(true);
    expect(boxArg.typeArguments![0]!.text).toBe("number");
  });

  // 26. [ST] construct → collectAt 호출 → valid ResolvedType
  it("should return valid ResolvedType when collector is freshly constructed and file is tracked", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/x.ts";
    const content = "const value: boolean = true;";
    prog.notifyFileChanged(filePath, content);

    // Act
    const collector = new TypeCollector(prog);
    const result = collector.collectAt(filePath, pos(content, "value"));

    // Assert
    expect(result).not.toBeNull();
    expect(result!.text).toBe("boolean");
  });

  // 27. [ST] notifyFileChanged 이전 collectAt → null, 이후 collectAt → valid
  it("should return null before file is tracked and valid type after file is tracked", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/y.ts";
    const content = "const item: string = 'test';";
    const collector = new TypeCollector(prog);

    // Act — before notify
    const before = collector.collectAt(filePath, pos(content, "item"));

    // Act — after notify
    prog.notifyFileChanged(filePath, content);
    const after = collector.collectAt(filePath, pos(content, "item"));

    // Assert
    expect(before).toBeNull();
    expect(after).not.toBeNull();
    expect(after!.text).toBe("string");
  });

  // 28. [ST] notifyFileChanged(타입 변경) → collectAt → 새 타입 반영
  it("should return updated type when file content is changed via notifyFileChanged", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/z.ts";
    const content1 = "const data: string = 'hello';";
    const content2 = "const data: number = 42;";
    prog.notifyFileChanged(filePath, content1);
    const collector = new TypeCollector(prog);

    // Act — initial type
    const first = collector.collectAt(filePath, pos(content1, "data"));
    expect(first?.text).toBe("string");

    // Act — after update
    prog.notifyFileChanged(filePath, content2);
    const second = collector.collectAt(filePath, pos(content2, "data"));

    // Assert
    expect(second).not.toBeNull();
    expect(second!.text).toBe("number");
  });

  // 29. [ST] construct → dispose → collectAt → throw
  it("should throw when collectAt is called after TscProgram is disposed", () => {
    // Arrange
    const prog = makeProg();
    const filePath = "/project/src/aa.ts";
    prog.notifyFileChanged(filePath, "const x: string = 'a';");
    const collector = new TypeCollector(prog);
    prog.dispose();

    // Act & Assert
    expect(() => collector.collectAt(filePath, 6)).toThrow();
  });

  // 30. [OR] collectAt(A, posA) then collectAt(B, posB) = 역순 → 서로 영향 없음
  it("should return independent results when collecting from two different files in different orders", () => {
    // Arrange
    const prog = makeProg();
    const fileA = "/project/src/file-a.ts";
    const fileB = "/project/src/file-b.ts";
    const contentA = "const alpha: string = 'a';";
    const contentB = "const beta: number = 0;";
    prog.notifyFileChanged(fileA, contentA);
    prog.notifyFileChanged(fileB, contentB);
    const collector = new TypeCollector(prog);

    // Act — A then B
    const a1 = collector.collectAt(fileA, pos(contentA, "alpha"));
    const b1 = collector.collectAt(fileB, pos(contentB, "beta"));

    // Act — B then A (fresh collector, same program)
    const collector2 = new TypeCollector(prog);
    const b2 = collector2.collectAt(fileB, pos(contentB, "beta"));
    const a2 = collector2.collectAt(fileA, pos(contentA, "alpha"));

    // Assert — order does not affect results
    expect(a1!.text).toBe(a2!.text);
    expect(b1!.text).toBe(b2!.text);
    expect(a1!.text).toBe("string");
    expect(b1!.text).toBe("number");
  });
});
