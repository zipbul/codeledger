import type { Program } from 'oxc-parser';
import { extractRelations } from '../extractor/relation-extractor';
import { toAbsolutePath, toRelativePath } from '../common/path-utils';
import { resolveImport, resolveBareSpecifier } from '../extractor/extractor-utils';
import { resolveFileProject } from '../common/project-discovery';
import type { ProjectBoundary } from '../common/project-discovery';
import type { TsconfigPaths } from '../common/tsconfig-resolver';

export interface RelationDbRow {
  project: string;
  type: string;
  srcFilePath: string;
  srcSymbolName: string | null;
  dstProject: string;
  dstFilePath: string;
  dstSymbolName: string | null;
  metaJson: string | null;
}

interface RelationRepoPart {
  replaceFileRelations(
    project: string,
    filePath: string,
    relations: RelationDbRow[],
  ): void;
}

export interface IndexFileRelationsOptions {
  ast: Program;
  project: string;
  filePath: string;
  relationRepo: RelationRepoPart;
  projectRoot: string;
  tsconfigPaths?: TsconfigPaths;
  /** 인덱싱된 파일 경로 Set. `${project}::${filePath}` 형식. */
  knownFiles?: Set<string>;
  /** 프로젝트 경계 목록 (dstProject 결정용) */
  boundaries?: ProjectBoundary[];
}

export function indexFileRelations(opts: IndexFileRelationsOptions): number {
  const { ast, project, filePath, relationRepo, projectRoot, tsconfigPaths, knownFiles, boundaries } = opts;

  const absFilePath = toAbsolutePath(projectRoot, filePath);

  // knownFiles가 주어지면, 후보 중 knownFiles에 있는 경로를 선택하는 커스텀 resolver 조립
  const customResolver = knownFiles
    ? (currentFile: string, importPath: string, paths?: TsconfigPaths) => {
        // 1. 기본 해석 (상대경로 + tsconfig paths)
        let candidates = resolveImport(currentFile, importPath, paths);

        // 2. bare specifier fallback
        if (candidates.length === 0) {
          candidates = resolveBareSpecifier(projectRoot, importPath);
        }

        // 3. 후보 중 knownFiles에 있는 첫 번째 선택
        for (const c of candidates) {
          const rel = toRelativePath(projectRoot, c);
          // 모든 project에서 검색
          if (boundaries) {
            const p = resolveFileProject(rel, boundaries);
            if (knownFiles.has(`${p}::${rel}`)) return [c];
          } else {
            if (knownFiles.has(`${project}::${rel}`)) return [c];
          }
        }
        return []; // knownFiles에 없으면 빈 배열 → relation 미생성
      }
    : undefined;

  const rawRelations = extractRelations(ast, absFilePath, tsconfigPaths, customResolver);

  const rows: RelationDbRow[] = [];

  for (const rel of rawRelations) {
    const relDst = toRelativePath(projectRoot, rel.dstFilePath);

    if (relDst.startsWith('..')) continue;

    const relSrc = toRelativePath(projectRoot, rel.srcFilePath);

    // dstProject 결정: boundaries가 있으면 dstFilePath 기준으로 project 해석
    const dstProject = boundaries
      ? resolveFileProject(relDst, boundaries)
      : project;

    rows.push({
      project,
      type: rel.type,
      srcFilePath: relSrc,
      srcSymbolName: rel.srcSymbolName ?? null,
      dstProject,
      dstFilePath: relDst,
      dstSymbolName: rel.dstSymbolName ?? null,
      metaJson: rel.metaJson ?? null,
    });
  }

  relationRepo.replaceFileRelations(project, filePath, rows);
  return rows.length;
}
