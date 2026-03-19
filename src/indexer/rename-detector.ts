export interface SymbolSnap {
  name: string;
  filePath: string;
  kind: string;
  fingerprint: string | null;
  structuralFingerprint: string | null;
  startLine: number;
  isExported: number;
}

export interface RenamedEntry {
  oldName: string;
  newName: string;
  filePath: string;
  kind: string;
}

export interface SymbolInfo {
  name: string;
  filePath: string;
  kind: string;
  fingerprint: string | null;
}

export interface DetectRenamesResult {
  renamed: RenamedEntry[];
  added: SymbolInfo[];
  removed: SymbolInfo[];
}

export function detectRenames(
  beforeSnapshot: Map<string, SymbolSnap>,
  afterSnapshot: Map<string, SymbolSnap>,
): DetectRenamesResult {
  const added: SymbolInfo[] = [];
  const removed: SymbolInfo[] = [];
  const renamed: RenamedEntry[] = [];

  // Compute diff
  for (const [key, snap] of afterSnapshot) {
    if (!beforeSnapshot.has(key)) {
      added.push({ name: snap.name, filePath: snap.filePath, kind: snap.kind, fingerprint: snap.fingerprint });
    }
  }
  for (const [key, snap] of beforeSnapshot) {
    if (!afterSnapshot.has(key)) {
      removed.push({ name: snap.name, filePath: snap.filePath, kind: snap.kind, fingerprint: snap.fingerprint });
    }
  }

  if (!added.length || !removed.length) return { renamed, added, removed };

  // Group by filePath for same-file rename detection
  const addedByFile = new Map<string, SymbolInfo[]>();
  const removedByFile = new Map<string, SymbolInfo[]>();

  for (const a of added) {
    const list = addedByFile.get(a.filePath) ?? [];
    list.push(a);
    addedByFile.set(a.filePath, list);
  }
  for (const r of removed) {
    const list = removedByFile.get(r.filePath) ?? [];
    list.push(r);
    removedByFile.set(r.filePath, list);
  }

  const matchedAdded = new Set<SymbolInfo>();
  const matchedRemoved = new Set<SymbolInfo>();

  // Same-file, same-kind, same structuralFingerprint matching
  for (const [filePath, fileAdded] of addedByFile) {
    const fileRemoved = removedByFile.get(filePath);
    if (!fileRemoved) continue;

    for (const kind of new Set(fileAdded.map(a => a.kind))) {
      const kindAdded = fileAdded.filter(a => a.kind === kind && !matchedAdded.has(a));
      const kindRemoved = fileRemoved.filter(r => r.kind === kind && !matchedRemoved.has(r));
      if (!kindAdded.length || !kindRemoved.length) continue;

      // Get structural fingerprints from snapshots
      const getStructFp = (info: SymbolInfo, snapshot: Map<string, SymbolSnap>) => {
        const snap = snapshot.get(`${info.filePath}::${info.name}`);
        return snap?.structuralFingerprint ?? null;
      };
      const getStartLine = (info: SymbolInfo, snapshot: Map<string, SymbolSnap>) => {
        const snap = snapshot.get(`${info.filePath}::${info.name}`);
        return snap?.startLine ?? 0;
      };

      // Build fingerprint → candidates maps
      const removedByFp = new Map<string, typeof kindRemoved>();
      for (const r of kindRemoved) {
        const fp = getStructFp(r, beforeSnapshot);
        if (!fp) continue;
        const list = removedByFp.get(fp) ?? [];
        list.push(r);
        removedByFp.set(fp, list);
      }

      for (const a of kindAdded) {
        if (matchedAdded.has(a)) continue;
        const fp = getStructFp(a, afterSnapshot);
        if (!fp) continue;
        const candidates = removedByFp.get(fp);
        if (!candidates) continue;

        const available = candidates.filter(c => !matchedRemoved.has(c));
        if (!available.length) continue;

        // 1:1 match or greedy by startLine proximity
        let best = available[0]!;
        if (available.length > 1) {
          const aLine = getStartLine(a, afterSnapshot);
          let bestDist = Math.abs(getStartLine(best, beforeSnapshot) - aLine);
          for (let i = 1; i < available.length; i++) {
            const dist = Math.abs(getStartLine(available[i]!, beforeSnapshot) - aLine);
            if (dist < bestDist) {
              bestDist = dist;
              best = available[i]!;
            }
          }
        }

        renamed.push({ oldName: best.name, newName: a.name, filePath, kind });
        matchedAdded.add(a);
        matchedRemoved.add(best);
      }
    }
  }

  // Parent rename → member propagation
  const parentRenames = renamed.filter(r => !r.oldName.includes('.'));
  for (const pr of parentRenames) {
    const oldPrefix = `${pr.oldName}.`;
    const newPrefix = `${pr.newName}.`;

    const memberRemoved = removed.filter(
      r => r.filePath === pr.filePath && r.name.startsWith(oldPrefix) && !matchedRemoved.has(r),
    );
    const memberAdded = added.filter(
      a => a.filePath === pr.filePath && a.name.startsWith(newPrefix) && !matchedAdded.has(a),
    );

    for (const mr of memberRemoved) {
      const suffix = mr.name.slice(oldPrefix.length);
      const match = memberAdded.find(ma => ma.name.slice(newPrefix.length) === suffix);
      if (match) {
        renamed.push({ oldName: mr.name, newName: match.name, filePath: pr.filePath, kind: mr.kind });
        matchedAdded.add(match);
        matchedRemoved.add(mr);
      }
    }
  }

  return {
    renamed,
    added: added.filter(a => !matchedAdded.has(a)),
    removed: removed.filter(r => !matchedRemoved.has(r)),
  };
}
