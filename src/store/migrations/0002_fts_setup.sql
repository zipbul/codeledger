CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
  name,
  file_path,
  kind,
  content=symbols,
  content_rowid=id
);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS symbols_ai
AFTER INSERT ON symbols BEGIN
  INSERT INTO symbols_fts(rowid, name, file_path, kind)
  VALUES (new.id, new.name, new.file_path, new.kind);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS symbols_ad
AFTER DELETE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, file_path, kind)
  VALUES ('delete', old.id, old.name, old.file_path, old.kind);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS symbols_au
AFTER UPDATE ON symbols BEGIN
  INSERT INTO symbols_fts(symbols_fts, rowid, name, file_path, kind)
  VALUES ('delete', old.id, old.name, old.file_path, old.kind);
  INSERT INTO symbols_fts(rowid, name, file_path, kind)
  VALUES (new.id, new.name, new.file_path, new.kind);
END;
