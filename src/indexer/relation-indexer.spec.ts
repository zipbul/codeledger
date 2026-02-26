import { beforeEach, describe, expect, it, mock } from 'bun:test';

const mockExtractRelations = mock((ast: any, filePath: string, tsconfig?: any, resolverFn?: any) => [] as any[]);

const mockToRelativePath = mock((root: string, abs: string) => '');
const mockToAbsolutePath = mock((root: string, rel: string) => '');
const mockResolveImport = mock((currentFile: string, importPath: string, paths?: any) => [] as string[]);
const mockResolveFileProject = mock((filePath: string, boundaries: any[]) => 'default');

mock.module('../extractor/relation-extractor', () => ({ extractRelations: mockExtractRelations }));
mock.module('../common/path-utils', () => ({
  toRelativePath: mockToRelativePath,
  toAbsolutePath: mockToAbsolutePath,
}));
mock.module('../extractor/extractor-utils', () => ({
  resolveImport: mockResolveImport,
}));
mock.module('../common/project-discovery', () => ({
  resolveFileProject: mockResolveFileProject,
}));
import { indexFileRelations } from './relation-indexer';

const PROJECT = 'test-project';
const PROJECT_ROOT = '/project';
const REL_FILE = 'src/index.ts';
const ABS_FILE = '/project/src/index.ts';

function makeRelation(overrides: Partial<{
  type: string; srcFilePath: string; srcSymbolName: string | null;
  dstFilePath: string; dstSymbolName: string | null; metaJson: string | null;
}> = {}) {
  return {
    type: 'imports',
    srcFilePath: ABS_FILE,
    srcSymbolName: null,
    dstFilePath: '/project/src/utils.ts',
    dstSymbolName: null,
    metaJson: null,
    ...overrides,
  };
}

function makeRelationRepo() {
  return { replaceFileRelations: mock((p: any, f: any, rels: any) => {}) };
}

describe('indexFileRelations', () => {
  beforeEach(() => {
    mock.module('../extractor/relation-extractor', () => ({ extractRelations: mockExtractRelations }));
    mock.module('../common/path-utils', () => ({
      toRelativePath: mockToRelativePath,
      toAbsolutePath: mockToAbsolutePath,
    }));
    mock.module('../extractor/extractor-utils', () => ({
      resolveImport: mockResolveImport,
    }));
    mock.module('../common/project-discovery', () => ({
      resolveFileProject: mockResolveFileProject,
    }));
    mockExtractRelations.mockReset();
    mockExtractRelations.mockReturnValue([]);
    mockToRelativePath.mockReset();
    mockToAbsolutePath.mockReset();
    mockResolveImport.mockReset();
    mockResolveFileProject.mockReset();
    mockResolveImport.mockReturnValue([]);
    mockResolveFileProject.mockReturnValue('default');
    mockToAbsolutePath.mockImplementation((root: string, rel: string) => `/project/${rel}`);
    mockToRelativePath.mockImplementation((root: string, abs: string) =>
      abs.replace('/project/', ''),
    );
  });
  it('should include relation when dst is within project root', () => {
    mockExtractRelations.mockReturnValue([makeRelation()]);
    mockToRelativePath.mockReturnValue('src/utils.ts');
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels.length).toBe(1);
  });

  it('should filter out relation when dst normalizes to path starting with ..', () => {
    mockExtractRelations.mockReturnValue([makeRelation({ dstFilePath: '/other/project/file.ts' })]);
    mockToRelativePath.mockImplementation((root: string, abs: string) =>
      abs.startsWith('/project') ? abs.replace('/project/', '') : `../other/project/${abs.split('/').pop()}`,
    );
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels).toEqual([]);
  });

  it('should call extractRelations when absolute filePath is provided', () => {
    mockToAbsolutePath.mockReturnValue(ABS_FILE);
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    expect(mockExtractRelations).toHaveBeenCalledWith(expect.anything(), ABS_FILE, undefined, undefined);
  });

  it('should call replaceFileRelations when relative filePath is computed', () => {
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, filePath] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(filePath).toBe(REL_FILE);
  });

  it('should normalize absolute dst paths when writing output relations', () => {
    mockExtractRelations.mockReturnValue([makeRelation({ dstFilePath: '/project/src/utils.ts' })]);
    mockToRelativePath.mockReturnValue('src/utils.ts');
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels[0].dstFilePath).toBe('src/utils.ts');
  });

  it('should call replaceFileRelations with empty array when extractRelations returns nothing', () => {
    mockExtractRelations.mockReturnValue([]);
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels).toEqual([]);
  });

  it('should retain only in-project relations when mix of in/out-project are returned', () => {
    mockExtractRelations.mockReturnValue([
      makeRelation({ dstFilePath: '/project/src/utils.ts' }),
      makeRelation({ dstFilePath: '/external/lib.ts' }),
    ]);
    mockToRelativePath.mockImplementation((root: string, abs: string) =>
      abs.startsWith('/project') ? 'src/utils.ts' : '../external/lib.ts',
    );
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels.length).toBe(1);
    expect(rels[0].dstFilePath).toBe('src/utils.ts');
  });

  it('should pass tsconfigPaths to extractRelations when provided', () => {
    const tsconfigPaths = { baseUrl: '/project', paths: new Map() };
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT, tsconfigPaths });

    expect(mockExtractRelations).toHaveBeenCalledWith(expect.anything(), expect.anything(), tsconfigPaths, undefined);
  });

  it('should pass empty array to replaceFileRelations when all relations are filtered', () => {
    mockExtractRelations.mockReturnValue([
      makeRelation({ dstFilePath: '/other1/file.ts' }),
      makeRelation({ dstFilePath: '/other2/file.ts' }),
    ]);
    mockToRelativePath.mockReturnValue('../other/file.ts');
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels).toEqual([]);
  });

  it('should produce identical calls when invoked twice with same input', () => {
    mockExtractRelations.mockReturnValue([makeRelation()]);
    mockToRelativePath.mockReturnValue('src/utils.ts');
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });
    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels1] = relationRepo.replaceFileRelations.mock.calls[0]!;
    const [, , rels2] = relationRepo.replaceFileRelations.mock.calls[1]!;
    expect(rels1.length).toBe(rels2.length);
  });

  it('should set srcFilePath to relative path when relation output is created', () => {
    mockExtractRelations.mockReturnValue([makeRelation({ srcFilePath: ABS_FILE })]);
    mockToRelativePath.mockImplementation((root: string, abs: string) => {
      if (abs === ABS_FILE) return REL_FILE;
      return 'src/utils.ts';
    });
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels[0].srcFilePath).toBe(REL_FILE);
  });

  // ─── Step 5: dstProject + knownFiles + boundaries ───────────────

  it('should include dstProject equal to project when boundaries not provided', () => {
    mockExtractRelations.mockReturnValue([makeRelation()]);
    mockToRelativePath.mockReturnValue('src/utils.ts');
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels[0].dstProject).toBe(PROJECT);
  });

  it('should set dstProject via resolveFileProject when boundaries provided', () => {
    mockExtractRelations.mockReturnValue([makeRelation()]);
    mockToRelativePath.mockReturnValue('src/utils.ts');
    mockResolveFileProject.mockReturnValue('other-project');
    const boundaries = [{ project: 'other-project', dir: 'src' }];
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT, boundaries });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels[0].dstProject).toBe('other-project');
  });

  it('should pass customResolver to extractRelations when knownFiles provided', () => {
    const knownFiles = new Set<string>([`${PROJECT}::src/utils.ts`]);
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT, knownFiles });

    const callArgs = (mockExtractRelations.mock.calls[0] as unknown[]);
    expect(callArgs.length).toBeGreaterThanOrEqual(4);
    expect(typeof callArgs[3]).toBe('function');
  });

  it('should not pass resolver arg when knownFiles not provided', () => {
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT });

    const callArgs = (mockExtractRelations.mock.calls[0] as unknown[]);
    expect(callArgs[3]).toBeUndefined();
  });

  it('should select candidate present in knownFiles using project format when no boundaries', () => {
    mockResolveImport.mockReturnValue(['/project/src/utils.ts']);
    mockToRelativePath.mockImplementation((root: string, abs: string) =>
      abs.startsWith('/project/') ? abs.replace('/project/', '') : `../${abs}`,
    );
    const knownFiles = new Set<string>([`${PROJECT}::src/utils.ts`]);

    // Configure extractRelations to invoke the customResolver via its 4th arg
    mockExtractRelations.mockImplementation((ast: any, filePath: string, tsconfig: any, resolverFn?: any) => {
      if (resolverFn) {
        const resolved = resolverFn(filePath, './utils', tsconfig);
        return resolved.map((r: string) => makeRelation({ dstFilePath: r }));
      }
      return [];
    });
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT, knownFiles });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels.length).toBe(1);
  });

  it('should select candidate present in knownFiles using resolveFileProject when boundaries present', () => {
    mockResolveImport.mockReturnValue(['/project/lib/helper.ts']);
    mockResolveFileProject.mockReturnValue('lib-project');
    mockToRelativePath.mockImplementation((root: string, abs: string) =>
      abs.startsWith('/project/') ? abs.replace('/project/', '') : `../${abs}`,
    );
    const boundaries = [{ project: 'lib-project', dir: 'lib' }];
    const knownFiles = new Set<string>(['lib-project::lib/helper.ts']);

    mockExtractRelations.mockImplementation((ast: any, filePath: string, tsconfig: any, resolverFn?: any) => {
      if (resolverFn) {
        const resolved = resolverFn(filePath, './helper', tsconfig);
        return resolved.map((r: string) => makeRelation({ dstFilePath: r }));
      }
      return [];
    });
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT, knownFiles, boundaries });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels.length).toBe(1);
  });

  it('should produce empty relation when candidate not in knownFiles', () => {
    mockResolveImport.mockReturnValue(['/project/src/missing.ts']);
    mockToRelativePath.mockImplementation((root: string, abs: string) =>
      abs.startsWith('/project/') ? abs.replace('/project/', '') : `../${abs}`,
    );
    const knownFiles = new Set<string>([`${PROJECT}::src/other.ts`]);

    mockExtractRelations.mockImplementation((ast: any, filePath: string, tsconfig: any, resolverFn?: any) => {
      if (resolverFn) {
        const resolved = resolverFn(filePath, './missing', tsconfig);
        return resolved.map((r: string) => makeRelation({ dstFilePath: r }));
      }
      return [];
    });
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT, knownFiles });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels).toEqual([]);
  });

  it('should create customResolver returning empty when knownFiles is empty Set', () => {
    const knownFiles = new Set<string>(); // empty Set → truthy

    mockExtractRelations.mockImplementation((ast: any, filePath: string, tsconfig: any, resolverFn?: any) => {
      // customResolver should exist but return []
      if (resolverFn) {
        mockResolveImport.mockReturnValue(['/project/src/utils.ts']);
        const resolved = resolverFn(filePath, './utils', tsconfig);
        return resolved.map((r: string) => makeRelation({ dstFilePath: r }));
      }
      return [makeRelation()]; // fallback if no resolver
    });
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT, knownFiles });

    const callArgs = (mockExtractRelations.mock.calls[0] as unknown[]);
    expect(typeof callArgs[3]).toBe('function');
    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels).toEqual([]);
  });

  it('should set different dstProjects per row when relations cross boundaries', () => {
    const boundaries = [{ project: 'proj-a', dir: 'apps/a' }, { project: 'proj-b', dir: 'apps/b' }];
    mockExtractRelations.mockReturnValue([
      makeRelation({ dstFilePath: '/project/apps/a/index.ts' }),
      makeRelation({ dstFilePath: '/project/apps/b/index.ts' }),
    ]);
    mockToRelativePath.mockImplementation((root: string, abs: string) =>
      abs.startsWith('/project/') ? abs.replace('/project/', '') : `../${abs}`,
    );
    mockResolveFileProject.mockImplementation((fp: string) => {
      if (fp.startsWith('apps/a')) return 'proj-a';
      if (fp.startsWith('apps/b')) return 'proj-b';
      return 'default';
    });
    const relationRepo = makeRelationRepo();

    indexFileRelations({ ast: {} as any, project: PROJECT, filePath: REL_FILE, relationRepo: relationRepo as any, projectRoot: PROJECT_ROOT, boundaries });

    const [, , rels] = relationRepo.replaceFileRelations.mock.calls[0]!;
    expect(rels[0].dstProject).toBe('proj-a');
    expect(rels[1].dstProject).toBe('proj-b');
  });

});
