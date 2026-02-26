import { describe, expect, it } from 'bun:test';
import { files, symbols, relations, watcherOwner } from './schema';

describe('schema', () => {
  it('should export a non-null files table definition', () => {
    expect(files).toBeDefined();
  });

  it('should export a non-null symbols table definition', () => {
    expect(symbols).toBeDefined();
  });

  it('should export a non-null relations table definition', () => {
    expect(relations).toBeDefined();
  });

  it('should have dstProject column defined in relations table when relations is read as a column map', () => {
    // After schema migration, relations must expose dstProject as a column.
    const relCols = relations as unknown as Record<string, { name: string } | undefined>;
    expect(relCols['dstProject']).toBeDefined();
  });

  it('should map dstProject to the SQL column name dst_project in relations table', () => {
    const relCols = relations as unknown as Record<string, { name: string } | undefined>;
    expect(relCols['dstProject']?.name).toBe('dst_project');
  });
});
