import { DB_NAME, DB_VERSION } from "../constants";
import type { DailyDomainStatRecord, DailySummaryRecord } from "../types";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("dailySummary")) {
          db.createObjectStore("dailySummary", { keyPath: "dateKey" });
        }
        if (!db.objectStoreNames.contains("dailyDomainStats")) {
          const store = db.createObjectStore("dailyDomainStats", { keyPath: "id" });
          store.createIndex("byDate", "dateKey", { unique: false });
        }
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function runRead<T>(
  storeName: "dailySummary" | "dailyDomainStats" | "meta",
  action: (store: IDBObjectStore) => IDBRequest<T>
) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readonly");
  const done = transactionDone(tx);
  const result = await requestToPromise(action(tx.objectStore(storeName)));
  await done;
  return result;
}

async function runWrite(
  storeName: "dailySummary" | "dailyDomainStats" | "meta",
  action: (store: IDBObjectStore) => void
) {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  const done = transactionDone(tx);
  action(tx.objectStore(storeName));
  await done;
}

export async function getDailySummary(dateKey: string) {
  return (await runRead("dailySummary", (store) => store.get(dateKey))) as DailySummaryRecord | undefined;
}

export async function putDailySummary(record: DailySummaryRecord) {
  await runWrite("dailySummary", (store) => {
    store.put(record);
  });
}

export async function getDailySummariesInRange(startDateKey: string, endDateKey: string) {
  return (await runRead("dailySummary", (store) => store.getAll(IDBKeyRange.bound(startDateKey, endDateKey)))) as
    | DailySummaryRecord[]
    | [];
}

export async function getDailyDomainStat(id: string) {
  return (await runRead("dailyDomainStats", (store) => store.get(id))) as DailyDomainStatRecord | undefined;
}

export async function putDailyDomainStat(record: DailyDomainStatRecord) {
  await runWrite("dailyDomainStats", (store) => {
    store.put(record);
  });
}

export async function getDailyDomainStatsInRange(startDateKey: string, endDateKey: string) {
  return (await runRead("dailyDomainStats", (store) =>
    store.index("byDate").getAll(IDBKeyRange.bound(startDateKey, endDateKey))
  )) as DailyDomainStatRecord[];
}

export async function clearAllIndexedDb() {
  const db = await openDb();
  await Promise.all(
    Array.from(db.objectStoreNames).map(
      (storeName) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          tx.objectStore(storeName).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
    )
  );
}

export async function cleanupBeforeDate(dateKey: string) {
  const db = await openDb();
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction("dailySummary", "readwrite");
      const store = tx.objectStore("dailySummary");
      const request = store.openCursor(IDBKeyRange.upperBound(dateKey, true));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }),
    new Promise<void>((resolve, reject) => {
      const tx = db.transaction("dailyDomainStats", "readwrite");
      const store = tx.objectStore("dailyDomainStats");
      const request = store.index("byDate").openCursor(IDBKeyRange.upperBound(dateKey, true));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    })
  ]);
}
