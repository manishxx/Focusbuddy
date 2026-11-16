/**
 * IndexedDB `fb` (DATA_MODEL §7): schema v1, promise helpers, connection
 * lifecycle and database deletion (§6 step 4). The factory is always passed in,
 * so tests use a fresh fake-indexeddb IDBFactory and the SW passes `indexedDB`.
 */

export const FB_DB_NAME = "fb";
export const FB_DB_VERSION = 1;

export const STORE_SEGMENTS = "segments";
export const STORE_INTERVENTIONS = "interventions";
export const STORE_SESSIONS = "sessions";
export const INDEX_BY_SESSION = "bySession";
export const INDEX_BY_ENDED_AT = "byEndedAt";

/** The IDBKeyRange statics the repositories use (injectable: Node has no global IDBKeyRange). */
export type KeyRangeApi = Pick<typeof IDBKeyRange, "bound" | "only" | "upperBound">;

/** A storage failure carrying a diag-safe code (never a browser error message). */
export class StorageError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "StorageError";
    this.code = code;
  }
}

/** A diag-safe code for any thrown value: StorageError keeps its code, everything else gets `fallback`. */
export function errorCode(error: unknown, fallback: string): string {
  return error instanceof StorageError ? error.code : fallback;
}

/** Creates the v1 stores and indexes. Idempotent: existing stores are left alone. */
export function upgradeFb(db: IDBDatabase, oldVersion: number): void {
  if (oldVersion >= 1) return;
  const names = db.objectStoreNames;
  if (!names.contains(STORE_SEGMENTS)) db.createObjectStore(STORE_SEGMENTS, { keyPath: ["sessionId", "seq"] });
  if (!names.contains(STORE_INTERVENTIONS)) {
    const s = db.createObjectStore(STORE_INTERVENTIONS, { keyPath: ["sessionId", "id"] });
    s.createIndex(INDEX_BY_SESSION, "sessionId");
  }
  if (!names.contains(STORE_SESSIONS)) {
    const s = db.createObjectStore(STORE_SESSIONS, { keyPath: "id" });
    s.createIndex(INDEX_BY_ENDED_AT, "endedAt");
  }
}

export type OpenFbOptions = {
  /** Called after the connection closed itself because another context wants a version change or deletion. */
  onVersionChangeClose?: () => void;
};

/**
 * Opens `fb` at version 1, upgrading in onupgradeneeded. Rejects with a
 * StorageError on error or when blocked; a connection that arrives after a
 * blocked rejection is closed at once so it can't leak.
 */
export function openFb(factory: IDBFactory, options: OpenFbOptions = {}): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(FB_DB_NAME, FB_DB_VERSION);
    } catch {
      reject(new StorageError("E_IDB_OPEN_THROW"));
      return;
    }
    req.onupgradeneeded = (event) => {
      try {
        upgradeFb(req.result, event.oldVersion);
      } catch {
        req.transaction?.abort();
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      if (settled) {
        db.close();
        return;
      }
      // Never hold up a deletion or upgrade from elsewhere: close and report.
      db.onversionchange = () => {
        db.close();
        options.onVersionChangeClose?.();
      };
      settle(() => resolve(db));
    };
    req.onerror = (event) => {
      event.preventDefault();
      settle(() => reject(new StorageError("E_IDB_OPEN")));
    };
    req.onblocked = () => {
      settle(() => reject(new StorageError("E_IDB_OPEN_BLOCKED")));
    };
  });
}

/**
 * Opens `fb` WITHOUT a version (DATA_MODEL §8 raw purge in safe mode). If the
 * database doesn't exist, the implicit creation is aborted, so a version-less
 * open never leaves an empty v1 database without stores behind. Resolves null
 * when there is no database.
 */
export function openFbExisting(factory: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let created = false;
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(FB_DB_NAME);
    } catch {
      reject(new StorageError("E_IDB_OPEN_THROW"));
      return;
    }
    req.onupgradeneeded = () => {
      created = true;
      req.transaction?.abort();
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = (event) => {
      event.preventDefault();
      if (created) resolve(null);
      else reject(new StorageError("E_IDB_OPEN"));
    };
    req.onblocked = () => reject(new StorageError("E_IDB_OPEN_BLOCKED"));
  });
}

/** Resolves with a request's result, rejects with a StorageError. */
export function request<T>(req: IDBRequest<T>, code = "E_IDB_REQUEST"): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = (event) => {
      event.preventDefault();
      reject(new StorageError(code));
    };
  });
}

/**
 * Runs `body` in one transaction and resolves with `read()` once it commits.
 * `body` issues requests (callbacks may chain more requests in the same
 * transaction) and returns a function that reads the outcome after commit.
 * Any error aborts the whole transaction: nothing is partially applied.
 */
export function runTx<T>(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => () => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    try {
      tx = db.transaction(stores, mode);
    } catch {
      reject(new StorageError("E_IDB_TX_OPEN"));
      return;
    }
    let read: () => T;
    try {
      read = body(tx);
    } catch {
      try {
        tx.abort();
      } catch {
        // Already finished; the abort handler below reports it.
      }
      reject(new StorageError("E_IDB_TX_BODY"));
      return;
    }
    tx.oncomplete = () => {
      try {
        resolve(read());
      } catch {
        reject(new StorageError("E_IDB_TX_READ"));
      }
    };
    tx.onabort = () => reject(new StorageError("E_IDB_TX_ABORT"));
  });
}

/** Calls each close function, ignoring failures (a connection may already be closed). */
function closeAll(closeFns: readonly (() => void)[]): void {
  for (const close of closeFns) {
    try {
      close();
    } catch {
      // Best effort: deletion reports blocked/timeout if a connection stays open.
    }
  }
}

export type DeleteFbOptions = { blockedTimeoutMs?: number };

/**
 * DATA_MODEL §6 step 4: close our connections, then deleteDatabase("fb"). On
 * `blocked` (a connection is still open) the close functions run again and the
 * pending deletion completes once the connections are gone; if it is still
 * blocked after `blockedTimeoutMs`, it rejects with E_IDB_DELETE_BLOCKED.
 */
export function deleteFbDatabase(
  factory: IDBFactory,
  closeFns: readonly (() => void)[],
  options: DeleteFbOptions = {},
): Promise<{ blocked: boolean }> {
  const timeoutMs = options.blockedTimeoutMs ?? 5_000;
  closeAll(closeFns);
  return new Promise((resolve, reject) => {
    let blocked = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = (): void => {
      if (timer !== undefined) clearTimeout(timer);
    };
    let req: IDBOpenDBRequest;
    try {
      req = factory.deleteDatabase(FB_DB_NAME);
    } catch {
      reject(new StorageError("E_IDB_DELETE_THROW"));
      return;
    }
    req.onsuccess = () => {
      done();
      resolve({ blocked });
    };
    req.onerror = (event) => {
      event.preventDefault();
      done();
      reject(new StorageError("E_IDB_DELETE"));
    };
    req.onblocked = () => {
      if (blocked) return;
      blocked = true;
      closeAll(closeFns);
      timer = setTimeout(() => reject(new StorageError("E_IDB_DELETE_BLOCKED")), timeoutMs);
    };
  });
}
