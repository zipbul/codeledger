import type { WatcherRole } from "./types";

interface WatcherOwnerRow {
  pid: number;
  heartbeat_at: string;
  instance_id: string | null;
}

export interface WatcherOwnerStore {
  immediateTransaction<T>(fn: () => T): T;
  selectOwner(): WatcherOwnerRow | undefined;
  insertOwner(pid: number, instanceId?: string): void;
  replaceOwner(pid: number, instanceId?: string): void;
  touchOwner(pid: number): void;
  deleteOwner(pid: number): void;
}

interface AcquireOptions {
  now?: () => number;
  isAlive?: (pid: number) => boolean;
  staleAfterSeconds?: number;
  instanceId?: string;
}

function defaultIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error) {
      return (error as { code?: string }).code !== "ESRCH";
    }

    return true;
  }
}

function toEpochMs(value: string): number {
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

export function acquireWatcherRole(
  db: WatcherOwnerStore,
  pid: number,
  options: AcquireOptions = {},
): WatcherRole {
  const now = options.now ?? Date.now;
  const isAlive = options.isAlive ?? defaultIsAlive;
  const staleAfterSeconds = options.staleAfterSeconds ?? 60;
  const instanceId = options.instanceId;

  return db.immediateTransaction(() => {
    const owner = db.selectOwner();
    if (!owner) {
      db.insertOwner(pid, instanceId);
      return "owner";
    }

    const heartbeatAgeSeconds = Math.floor((now() - toEpochMs(owner.heartbeat_at)) / 1000);
    const pidAlive = isAlive(owner.pid);

    // PID recycling check: if PID is alive but instance_id doesn't match,
    // the OS recycled the PID to an unrelated process
    if (pidAlive && instanceId && owner.instance_id && owner.instance_id !== instanceId && owner.pid !== pid) {
      db.replaceOwner(pid, instanceId);
      return "owner";
    }

    if (pidAlive && heartbeatAgeSeconds < staleAfterSeconds) {
      return "reader";
    }

    db.replaceOwner(pid, instanceId);
    return "owner";
  });
}

export function releaseWatcherRole(db: WatcherOwnerStore, pid: number): void {
  db.deleteOwner(pid);
}

export function updateHeartbeat(db: WatcherOwnerStore, pid: number): void {
  db.touchOwner(pid);
}
