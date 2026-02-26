import { eq, and, isNull, or, sql } from 'drizzle-orm';
import { relations as relationsTable } from '../schema';
import type { DbConnection } from '../connection';

export interface RelationRecord {
  project: string;
  type: string;
  srcFilePath: string;
  srcSymbolName: string | null;
  dstProject: string;
  dstFilePath: string;
  dstSymbolName: string | null;
  metaJson: string | null;
}

export class RelationRepository {
  constructor(private readonly db: DbConnection) {}

  replaceFileRelations(
    project: string,
    srcFilePath: string,
    rels: ReadonlyArray<Partial<RelationRecord>>,
  ): void {
    this.db.transaction((tx) => {
      tx.drizzleDb
        .delete(relationsTable)
        .where(and(eq(relationsTable.project, project), eq(relationsTable.srcFilePath, srcFilePath)))
        .run();

      if (!rels.length) return;

      for (const rel of rels) {
        tx.drizzleDb.insert(relationsTable).values({
          project,
          type: rel.type ?? 'unknown',
          srcFilePath: rel.srcFilePath ?? srcFilePath,
          srcSymbolName: rel.srcSymbolName ?? null,
          dstProject: rel.dstProject ?? project,
          dstFilePath: rel.dstFilePath ?? '',
          dstSymbolName: rel.dstSymbolName ?? null,
          metaJson: rel.metaJson ?? null,
        }).run();
      }
    });
  }

  getOutgoing(project: string, srcFilePath: string, srcSymbolName?: string): RelationRecord[] {
    if (srcSymbolName !== undefined) {
      return this.db.drizzleDb
        .select({
          project: relationsTable.project,
          type: relationsTable.type,
          srcFilePath: relationsTable.srcFilePath,
          srcSymbolName: relationsTable.srcSymbolName,
          dstProject: relationsTable.dstProject,
          dstFilePath: relationsTable.dstFilePath,
          dstSymbolName: relationsTable.dstSymbolName,
          metaJson: relationsTable.metaJson,
        })
        .from(relationsTable)
        .where(
          and(
            eq(relationsTable.project, project),
            eq(relationsTable.srcFilePath, srcFilePath),
            or(
              eq(relationsTable.srcSymbolName, srcSymbolName),
              isNull(relationsTable.srcSymbolName),
            ),
          ),
        )
        .all();
    }

    return this.db.drizzleDb
      .select({
        project: relationsTable.project,
        type: relationsTable.type,
        srcFilePath: relationsTable.srcFilePath,
        srcSymbolName: relationsTable.srcSymbolName,
        dstProject: relationsTable.dstProject,
        dstFilePath: relationsTable.dstFilePath,
        dstSymbolName: relationsTable.dstSymbolName,
        metaJson: relationsTable.metaJson,
      })
      .from(relationsTable)
      .where(
        and(
          eq(relationsTable.project, project),
          eq(relationsTable.srcFilePath, srcFilePath),
        ),
      )
      .all();
  }

  getIncoming(opts: { dstProject: string; dstFilePath: string }): RelationRecord[] {
    const { dstProject, dstFilePath } = opts;
    return this.db.drizzleDb
      .select({
        project: relationsTable.project,
        type: relationsTable.type,
        srcFilePath: relationsTable.srcFilePath,
        srcSymbolName: relationsTable.srcSymbolName,
        dstProject: relationsTable.dstProject,
        dstFilePath: relationsTable.dstFilePath,
        dstSymbolName: relationsTable.dstSymbolName,
        metaJson: relationsTable.metaJson,
      })
      .from(relationsTable)
      .where(
        and(
          eq(relationsTable.dstProject, dstProject),
          eq(relationsTable.dstFilePath, dstFilePath),
        ),
      )
      .all();
  }

  getByType(project: string, type: string): RelationRecord[] {
    return this.db.drizzleDb
      .select({
        project: relationsTable.project,
        type: relationsTable.type,
        srcFilePath: relationsTable.srcFilePath,
        srcSymbolName: relationsTable.srcSymbolName,
        dstProject: relationsTable.dstProject,
        dstFilePath: relationsTable.dstFilePath,
        dstSymbolName: relationsTable.dstSymbolName,
        metaJson: relationsTable.metaJson,
      })
      .from(relationsTable)
      .where(
        and(
          eq(relationsTable.project, project),
          eq(relationsTable.type, type),
        ),
      )
      .all();
  }

  deleteFileRelations(project: string, srcFilePath: string): void {
    this.db.drizzleDb
      .delete(relationsTable)
      .where(and(eq(relationsTable.project, project), eq(relationsTable.srcFilePath, srcFilePath)))
      .run();
  }

  searchRelations(opts: {
    srcFilePath?: string;
    srcSymbolName?: string;
    dstProject?: string;
    dstFilePath?: string;
    dstSymbolName?: string;
    type?: string;
    project?: string;
    limit: number;
  }): RelationRecord[] {
    return this.db.drizzleDb
      .select({
        project: relationsTable.project,
        type: relationsTable.type,
        srcFilePath: relationsTable.srcFilePath,
        srcSymbolName: relationsTable.srcSymbolName,
        dstProject: relationsTable.dstProject,
        dstFilePath: relationsTable.dstFilePath,
        dstSymbolName: relationsTable.dstSymbolName,
        metaJson: relationsTable.metaJson,
      })
      .from(relationsTable)
      .where(
        and(
          opts.project !== undefined ? eq(relationsTable.project, opts.project) : undefined,
          opts.srcFilePath !== undefined
            ? eq(relationsTable.srcFilePath, opts.srcFilePath)
            : undefined,
          opts.srcSymbolName !== undefined
            ? eq(relationsTable.srcSymbolName, opts.srcSymbolName)
            : undefined,
          opts.dstProject !== undefined
            ? eq(relationsTable.dstProject, opts.dstProject)
            : undefined,
          opts.dstFilePath !== undefined
            ? eq(relationsTable.dstFilePath, opts.dstFilePath)
            : undefined,
          opts.dstSymbolName !== undefined
            ? eq(relationsTable.dstSymbolName, opts.dstSymbolName)
            : undefined,
          opts.type !== undefined ? eq(relationsTable.type, opts.type) : undefined,
        ),
      )
      .limit(opts.limit)
      .all();
  }

  retargetRelations(opts: {
    dstProject: string;
    oldFile: string;
    oldSymbol: string | null;
    newFile: string;
    newSymbol: string | null;
    newDstProject?: string;
  }): void {
    const { dstProject, oldFile, oldSymbol, newFile, newSymbol, newDstProject } = opts;
    const condition = oldSymbol === null
      ? and(
          eq(relationsTable.dstProject, dstProject),
          eq(relationsTable.dstFilePath, oldFile),
          isNull(relationsTable.dstSymbolName),
        )
      : and(
          eq(relationsTable.dstProject, dstProject),
          eq(relationsTable.dstFilePath, oldFile),
          eq(relationsTable.dstSymbolName, oldSymbol),
        );

    const setValues: { dstFilePath: string; dstSymbolName: string | null; dstProject?: string } = {
      dstFilePath: newFile,
      dstSymbolName: newSymbol,
    };
    if (newDstProject !== undefined) {
      setValues.dstProject = newDstProject;
    }

    this.db.drizzleDb
      .update(relationsTable)
      .set(setValues)
      .where(condition)
      .run();
  }
}
