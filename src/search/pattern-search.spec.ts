import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockFindInFiles = mock(async (_lang: any, _config: any, _callback: any) => 0);

mock.module('@ast-grep/napi', () => ({
  Lang: { TypeScript: 'TypeScript' },
  findInFiles: mockFindInFiles,
}));

import { patternSearch } from './pattern-search';

beforeEach(() => {
  mockFindInFiles.mockClear();
  mockFindInFiles.mockImplementation(async (_lang, _config, callback) => {
    callback(null, []);
    return 0;
  });
});

describe('patternSearch', () => {
  // 1. [HP] filePaths 비어있으면 즉시 빈 배열 반환
  it('should return empty array immediately when filePaths is empty', async () => {
    const result = await patternSearch({ pattern: 'foo()', filePaths: [] });

    expect(result).toEqual([]);
    expect(mockFindInFiles).not.toHaveBeenCalled();
  });

  // 2. [HP] findInFiles 호출 시 pattern과 paths 전달
  it('should call findInFiles with correct pattern and paths', async () => {
    await patternSearch({ pattern: 'console.log($$$)', filePaths: ['/src/a.ts'] });

    expect(mockFindInFiles).toHaveBeenCalledWith(
      'TypeScript',
      expect.objectContaining({
        paths: ['/src/a.ts'],
        matcher: { rule: { pattern: 'console.log($$$)' } },
      }),
      expect.any(Function),
    );
  });

  // 3. [HP] 콜백 결과를 PatternMatch 배열로 변환
  it('should map SgNode results to PatternMatch with 1-based line numbers', async () => {
    const fakeNode = {
      range: () => ({ start: { line: 4, column: 0 }, end: { line: 4, column: 15 } }),
      text: () => 'console.log("hi")',
      getRoot: () => ({ filename: () => '/src/a.ts' }),
    };
    mockFindInFiles.mockImplementation(async (_lang, _config, callback) => {
      callback(null, [fakeNode]);
      return 1;
    });

    const result = await patternSearch({ pattern: 'console.log($$$)', filePaths: ['/src/a.ts'] });

    expect(result).toEqual([{
      filePath: '/src/a.ts',
      startLine: 5, // 0-based 4 → 1-based 5
      endLine: 5,
      matchedText: 'console.log("hi")',
    }]);
  });

  // 4. [HP] 매칭 없음 → 빈 배열
  it('should return empty array when findInFiles calls callback with empty nodes', async () => {
    mockFindInFiles.mockImplementation(async (_lang, _config, callback) => {
      callback(null, []);
      return 0;
    });

    const result = await patternSearch({ pattern: 'nonExistent()', filePaths: ['/src/a.ts'] });

    expect(result).toEqual([]);
  });

  // 5. [EP] 콜백 err 있을 때 → 해당 배치 무시 (결과 없음)
  it('should skip nodes when callback receives an error', async () => {
    mockFindInFiles.mockImplementation(async (_lang, _config, callback) => {
      callback(new Error('parse error'), []);
      return 0;
    });

    const result = await patternSearch({ pattern: 'foo()', filePaths: ['/src/a.ts'] });

    expect(result).toEqual([]);
  });

  // 6. [HP] 여러 노드 → 모두 수집
  it('should collect all nodes from multiple callback results', async () => {
    const makeNode = (line: number, file: string) => ({
      range: () => ({ start: { line }, end: { line } }),
      text: () => `node-${line}`,
      getRoot: () => ({ filename: () => file }),
    });
    mockFindInFiles.mockImplementation(async (_lang, _config, callback) => {
      callback(null, [makeNode(0, '/src/a.ts'), makeNode(2, '/src/b.ts')]);
      return 2;
    });

    const result = await patternSearch({ pattern: 'foo()', filePaths: ['/src/a.ts', '/src/b.ts'] });

    expect(result.length).toBe(2);
    expect(result[0]!.filePath).toBe('/src/a.ts');
    expect(result[1]!.filePath).toBe('/src/b.ts');
  });
});
