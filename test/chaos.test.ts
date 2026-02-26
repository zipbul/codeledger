import { beforeEach, describe, expect, it } from "bun:test";
import {
  acquireWatcherRole,
  releaseWatcherRole,
  updateHeartbeat,
} from "../src/watcher/ownership";
import type { WatcherOwnerStore } from "../src/watcher/ownership";

// ---------------------------------------------------------------------------
// Fake in-memory WatcherOwnerStore
// ---------------------------------------------------------------------------

type OwnerRow = { pid: number; heartbeat_at: string; instance_id: string | null };

function createFakeStore(): WatcherOwnerStore & { row: OwnerRow | undefined } {
  const state: { row: OwnerRow | undefined } = { row: undefined };

  return {
    get row() {
      return state.row;
    },
    set row(v: OwnerRow | undefined) {
      state.row = v;
    },

    immediateTransaction<T>(fn: () => T): T {
      return fn();
    },
    selectOwner() {
      return state.row;
    },
    insertOwner(pid: number, instanceId?: string) {
      state.row = {
        pid,
        heartbeat_at: new Date().toISOString(),
        instance_id: instanceId ?? null,
      };
    },
    replaceOwner(pid: number, instanceId?: string) {
      state.row = {
        pid,
        heartbeat_at: new Date().toISOString(),
        instance_id: instanceId ?? null,
      };
    },
    touchOwner(pid: number) {
      if (state.row?.pid === pid) {
        state.row = { ...state.row, heartbeat_at: new Date().toISOString() };
      }
    },
    deleteOwner(pid: number) {
      if (state.row?.pid === pid) {
        state.row = undefined;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a deterministic `now()` that returns `baseMs`. */
function clockAt(baseMs: number): () => number {
  return () => baseMs;
}

/** Returns a heartbeat_at ISO string that is `ageSeconds` old relative to `nowMs`. */
function staleHeartbeat(nowMs: number, ageSeconds: number): string {
  return new Date(nowMs - ageSeconds * 1000).toISOString();
}

const STALE_THRESHOLD = 60; // seconds

// ---------------------------------------------------------------------------
// Test Scenarios
// ---------------------------------------------------------------------------

describe("chaos: watcher ownership", () => {
  let db: ReturnType<typeof createFakeStore>;
  let nowMs: number;

  beforeEach(() => {
    db = createFakeStore();
    nowMs = Date.now();
  });

  // ── Scenario 1: Owner crash simulation ──────────────────────────────────
  describe("owner crash simulation", () => {
    it("should promote reader to owner when current owner process is dead", () => {
      const OWNER_PID = 1000;
      const READER_PID = 2000;

      // Owner acquires role
      const ownerRole = acquireWatcherRole(db, OWNER_PID, {
        now: clockAt(nowMs),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });
      expect(ownerRole).toBe("owner");
      expect(db.row?.pid).toBe(OWNER_PID);

      // Reader attempts — owner is alive and heartbeat is fresh, so becomes reader
      const readerRole = acquireWatcherRole(db, READER_PID, {
        now: clockAt(nowMs + 5_000),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });
      expect(readerRole).toBe("reader");
      expect(db.row?.pid).toBe(OWNER_PID);

      // Owner crashes — PID is now dead
      const promotedRole = acquireWatcherRole(db, READER_PID, {
        now: clockAt(nowMs + 10_000),
        isAlive: (pid) => pid !== OWNER_PID,
        staleAfterSeconds: STALE_THRESHOLD,
      });
      expect(promotedRole).toBe("owner");
      expect(db.row?.pid).toBe(READER_PID);
    });

    it("should promote reader to owner when owner heartbeat goes stale", () => {
      const OWNER_PID = 1000;
      const READER_PID = 2000;

      // Owner acquires role
      acquireWatcherRole(db, OWNER_PID, {
        now: clockAt(nowMs),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });

      // Simulate stale heartbeat by setting heartbeat_at far in the past
      db.row = {
        pid: OWNER_PID,
        heartbeat_at: staleHeartbeat(nowMs, STALE_THRESHOLD + 30),
        instance_id: null,
      };

      // Reader detects staleness and promotes
      const role = acquireWatcherRole(db, READER_PID, {
        now: clockAt(nowMs),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });
      expect(role).toBe("owner");
      expect(db.row?.pid).toBe(READER_PID);
    });
  });

  // ── Scenario 2: Multiple reader contention ─────────────────────────────
  describe("multiple reader contention", () => {
    it("should allow only one of three readers to promote when owner dies", () => {
      const OWNER_PID = 1000;
      const READER_A = 2000;
      const READER_B = 3000;
      const READER_C = 4000;

      // Owner acquires
      acquireWatcherRole(db, OWNER_PID, {
        now: clockAt(nowMs),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });

      // All three try to acquire — all become readers
      for (const readerPid of [READER_A, READER_B, READER_C]) {
        const role = acquireWatcherRole(db, readerPid, {
          now: clockAt(nowMs + 1_000),
          isAlive: () => true,
          staleAfterSeconds: STALE_THRESHOLD,
        });
        expect(role).toBe("reader");
      }

      // Owner dies
      const isAlive = (pid: number) => pid !== OWNER_PID;

      // Reader A gets there first and promotes
      const roleA = acquireWatcherRole(db, READER_A, {
        now: clockAt(nowMs + 5_000),
        isAlive,
        staleAfterSeconds: STALE_THRESHOLD,
      });
      expect(roleA).toBe("owner");
      expect(db.row?.pid).toBe(READER_A);

      // Reader B and C now see Reader A as the alive owner — they stay readers
      const roleB = acquireWatcherRole(db, READER_B, {
        now: clockAt(nowMs + 5_500),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });
      expect(roleB).toBe("reader");
      expect(db.row?.pid).toBe(READER_A);

      const roleC = acquireWatcherRole(db, READER_C, {
        now: clockAt(nowMs + 5_600),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });
      expect(roleC).toBe("reader");
      expect(db.row?.pid).toBe(READER_A);
    });

    it("should keep contending readers as readers while owner heartbeat is fresh", () => {
      const OWNER_PID = 1000;
      const readers = [2000, 3000, 4000];

      acquireWatcherRole(db, OWNER_PID, {
        now: clockAt(nowMs),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });

      // Simulate multiple rounds of reader healthchecks with a fresh owner
      for (let round = 0; round < 5; round++) {
        for (const readerPid of readers) {
          const role = acquireWatcherRole(db, readerPid, {
            now: clockAt(nowMs + round * 10_000),
            isAlive: () => true,
            staleAfterSeconds: STALE_THRESHOLD,
          });
          expect(role).toBe("reader");
        }
        // Owner refreshes heartbeat each round
        updateHeartbeat(db, OWNER_PID);
      }

      expect(db.row?.pid).toBe(OWNER_PID);
    });
  });

  // ── Scenario 3: Heartbeat timeout chain (A → B → C) ───────────────────
  describe("heartbeat timeout chain", () => {
    it("should support successive promotions A → B → C when each owner goes stale", () => {
      const PID_A = 1000;
      const PID_B = 2000;
      const PID_C = 3000;

      // A becomes owner
      const roleA = acquireWatcherRole(db, PID_A, {
        now: clockAt(nowMs),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });
      expect(roleA).toBe("owner");
      expect(db.row?.pid).toBe(PID_A);

      // A goes stale (heartbeat not refreshed for > threshold)
      db.row = {
        pid: PID_A,
        heartbeat_at: staleHeartbeat(nowMs + 120_000, STALE_THRESHOLD + 1),
        instance_id: null,
      };

      // B detects staleness and promotes
      const roleB = acquireWatcherRole(db, PID_B, {
        now: clockAt(nowMs + 120_000),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });
      expect(roleB).toBe("owner");
      expect(db.row?.pid).toBe(PID_B);

      // B heartbeats for a while, then goes stale
      updateHeartbeat(db, PID_B);
      db.row = {
        pid: PID_B,
        heartbeat_at: staleHeartbeat(nowMs + 300_000, STALE_THRESHOLD + 1),
        instance_id: null,
      };

      // C detects staleness and promotes
      const roleC = acquireWatcherRole(db, PID_C, {
        now: clockAt(nowMs + 300_000),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });
      expect(roleC).toBe("owner");
      expect(db.row?.pid).toBe(PID_C);
    });

    it("should not promote B when A is stale but A comes back alive and refreshes heartbeat before B checks", () => {
      const PID_A = 1000;
      const PID_B = 2000;

      // A becomes owner
      acquireWatcherRole(db, PID_A, {
        now: clockAt(nowMs),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });

      // A appears stale momentarily, but then refreshes before B checks
      updateHeartbeat(db, PID_A);

      // B checks — A is alive and heartbeat is now fresh
      const roleB = acquireWatcherRole(db, PID_B, {
        now: clockAt(nowMs + 10_000),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });
      expect(roleB).toBe("reader");
      expect(db.row?.pid).toBe(PID_A);
    });
  });

  // ── Scenario 4: PID recycling ─────────────────────────────────────────
  describe("PID recycling", () => {
    it("should detect PID recycling via mismatched instance_id and promote new caller", () => {
      const OLD_OWNER_PID = 5000;
      const NEW_CALLER_PID = 6000;

      // Original owner acquires with instance_id
      acquireWatcherRole(db, OLD_OWNER_PID, {
        now: clockAt(nowMs),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
        instanceId: "uuid-A",
      });
      expect(db.row?.pid).toBe(OLD_OWNER_PID);
      expect(db.row?.instance_id).toBe("uuid-A");

      // Owner "dies", OS recycles PID 5000 to an unrelated process.
      // A new caller (PID 6000) with instance_id "uuid-B" attempts to acquire.
      // isAlive returns true for OLD_OWNER_PID because the OS recycled that PID.
      const role = acquireWatcherRole(db, NEW_CALLER_PID, {
        now: clockAt(nowMs + 5_000),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
        instanceId: "uuid-B",
      });

      expect(role).toBe("owner");
      expect(db.row?.pid).toBe(NEW_CALLER_PID);
      expect(db.row?.instance_id).toBe("uuid-B");
    });

    it("should fall back to stale heartbeat check when same PID re-acquires with different instance_id", () => {
      const RECYCLED_PID = 5000;

      // Original owner acquires with instance_id "uuid-A"
      acquireWatcherRole(db, RECYCLED_PID, {
        now: clockAt(nowMs),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
        instanceId: "uuid-A",
      });

      // Same PID but different instance_id — the PID recycling branch
      // requires owner.pid !== pid, so this falls through to heartbeat check.
      // Heartbeat is still fresh, so this returns reader.
      const role = acquireWatcherRole(db, RECYCLED_PID, {
        now: clockAt(nowMs + 5_000),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
        instanceId: "uuid-B",
      });

      // The same PID is treated as "our own row" — not a recycled PID scenario
      expect(role).toBe("reader");
      expect(db.row?.pid).toBe(RECYCLED_PID);
      expect(db.row?.instance_id).toBe("uuid-A");
    });

    it("should promote same PID with different instance_id only when heartbeat is stale", () => {
      const RECYCLED_PID = 5000;

      // Original owner acquires with instance_id "uuid-A"
      acquireWatcherRole(db, RECYCLED_PID, {
        now: clockAt(nowMs),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
        instanceId: "uuid-A",
      });

      // Heartbeat goes stale
      db.row = {
        pid: RECYCLED_PID,
        heartbeat_at: staleHeartbeat(nowMs + 120_000, STALE_THRESHOLD + 1),
        instance_id: "uuid-A",
      };

      // Same PID, different instance_id, but stale heartbeat => promotes
      const role = acquireWatcherRole(db, RECYCLED_PID, {
        now: clockAt(nowMs + 120_000),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
        instanceId: "uuid-B",
      });

      expect(role).toBe("owner");
      expect(db.row?.pid).toBe(RECYCLED_PID);
      expect(db.row?.instance_id).toBe("uuid-B");
    });

    it("should not trigger PID recycling when neither side provides an instance_id", () => {
      const OWNER_PID = 5000;
      const READER_PID = 6000;

      // Owner acquires without instance_id
      acquireWatcherRole(db, OWNER_PID, {
        now: clockAt(nowMs),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });

      // Reader acquires without instance_id — PID recycling detection requires
      // both instance_ids to be present, so this falls through to normal check
      const role = acquireWatcherRole(db, READER_PID, {
        now: clockAt(nowMs + 5_000),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });

      expect(role).toBe("reader");
      expect(db.row?.pid).toBe(OWNER_PID);
    });
  });

  // ── Scenario 5: Max retry exceeded → graceful shutdown ─────────────────
  describe("max retry exceeded", () => {
    it("should surface error after consecutive acquireWatcherRole failures exhaust retries", () => {
      const MAX_RETRIES = 5;
      let failures = 0;

      // Simulate a healthcheck loop that calls acquireWatcherRole repeatedly.
      // The store's immediateTransaction throws to simulate DB lock contention.
      const brokenDb = createFakeStore();
      const originalTransaction = brokenDb.immediateTransaction.bind(brokenDb);
      brokenDb.immediateTransaction = <T>(fn: () => T): T => {
        throw new Error("SQLITE_BUSY: database is locked");
      };

      let lastError: Error | null = null;

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          acquireWatcherRole(brokenDb, 1000, {
            now: clockAt(nowMs),
            isAlive: () => true,
            staleAfterSeconds: STALE_THRESHOLD,
          });
        } catch (err) {
          failures++;
          lastError = err as Error;
        }
      }

      expect(failures).toBe(MAX_RETRIES);
      expect(lastError).not.toBeNull();
      expect(lastError!.message).toContain("SQLITE_BUSY");
    });

    it("should recover when transient failures resolve before max retries", () => {
      const MAX_RETRIES = 5;
      const FAIL_UNTIL = 3; // Fail the first 3, succeed on attempt 4
      let attempt = 0;

      const flakyDb = createFakeStore();
      const realTransaction = flakyDb.immediateTransaction.bind(flakyDb);
      flakyDb.immediateTransaction = <T>(fn: () => T): T => {
        attempt++;
        if (attempt <= FAIL_UNTIL) {
          throw new Error("SQLITE_BUSY: database is locked");
        }
        return realTransaction(fn);
      };

      let failures = 0;
      let role: string | null = null;

      for (let i = 0; i < MAX_RETRIES; i++) {
        try {
          role = acquireWatcherRole(flakyDb, 1000, {
            now: clockAt(nowMs),
            isAlive: () => true,
            staleAfterSeconds: STALE_THRESHOLD,
          });
          break; // Success — stop retrying
        } catch {
          failures++;
        }
      }

      expect(failures).toBe(FAIL_UNTIL);
      expect(role).toBe("owner");
      expect(flakyDb.row?.pid).toBe(1000);
    });

    it("should give up gracefully when all retries are exhausted", () => {
      const MAX_RETRIES = 3;
      const errors: Error[] = [];

      const brokenDb = createFakeStore();
      brokenDb.immediateTransaction = <T>(_fn: () => T): T => {
        throw new Error("SQLITE_BUSY: database is locked");
      };

      for (let i = 0; i < MAX_RETRIES; i++) {
        try {
          acquireWatcherRole(brokenDb, 1000, {
            now: clockAt(nowMs),
            isAlive: () => true,
            staleAfterSeconds: STALE_THRESHOLD,
          });
        } catch (err) {
          errors.push(err as Error);
        }
      }

      // System has given up — all retries exhausted, no owner row was written
      expect(errors).toHaveLength(MAX_RETRIES);
      expect(brokenDb.row).toBeUndefined();
      errors.forEach((err) => {
        expect(err.message).toContain("SQLITE_BUSY");
      });
    });
  });

  // ── Additional edge case: release + re-acquire cycle ───────────────────
  describe("release and re-acquire cycle", () => {
    it("should allow a new owner after explicit release by the current owner", () => {
      const PID_A = 1000;
      const PID_B = 2000;

      // A becomes owner
      acquireWatcherRole(db, PID_A, {
        now: clockAt(nowMs),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });
      expect(db.row?.pid).toBe(PID_A);

      // A explicitly releases
      releaseWatcherRole(db, PID_A);
      expect(db.row).toBeUndefined();

      // B acquires — empty row means immediate owner
      const role = acquireWatcherRole(db, PID_B, {
        now: clockAt(nowMs + 1_000),
        isAlive: () => true,
        staleAfterSeconds: STALE_THRESHOLD,
      });
      expect(role).toBe("owner");
      expect(db.row?.pid).toBe(PID_B);
    });

    it("should allow rapid owner churn through release-acquire cycles", () => {
      const pids = [1000, 2000, 3000, 4000, 5000];

      for (let i = 0; i < pids.length; i++) {
        const pid = pids[i]!;

        const role = acquireWatcherRole(db, pid, {
          now: clockAt(nowMs + i * 1_000),
          isAlive: () => true,
          staleAfterSeconds: STALE_THRESHOLD,
        });
        expect(role).toBe("owner");
        expect(db.row?.pid).toBe(pid);

        updateHeartbeat(db, pid);
        releaseWatcherRole(db, pid);
        expect(db.row).toBeUndefined();
      }
    });
  });
});
