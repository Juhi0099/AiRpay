import { openDB } from "idb";
const DB_NAME = "nosignal-vouchers";
const STORE = "vouchers";
const dbPromise = openDB(DB_NAME, 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains(STORE)) {
      const store = db.createObjectStore(STORE, { keyPath: "id" });
      store.createIndex("status", "status");
      store.createIndex("createdAt", "createdAt");
    }
  }
});

export async function saveVoucher(voucher) {
  const db = await dbPromise;
  const record = {
    ...voucher,
    id: voucher.id || `${voucher.payer}-${voucher.nonce}`,
    status: voucher.status || "pending",
    updatedAt: Date.now(),
    createdAt: voucher.createdAt || Date.now(),
  };
  await db.put(STORE, record);
  return record;
}

export async function getVoucher(id) { return (await dbPromise).get(STORE, id); }
export async function getAllVouchers() { return (await dbPromise).getAll(STORE); }
export async function getUnsyncedVouchers() { return (await dbPromise).getAllFromIndex(STORE, "status", "pending"); }

export async function markVoucherSettled(id, txHash) {
  const db = await dbPromise;
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const record = await store.get(id);
  if (record) {
    await store.put({ ...record, status: "settled", txHash, settledAt: Date.now(), updatedAt: Date.now() });
  }
  await tx.done;
  return record ? { ...record, status: "settled", txHash } : null;
}

export async function markVoucherFailed(id, error) {
  const db = await dbPromise;
  const record = await db.get(STORE, id);
  if (record) {
    await db.put(STORE, { ...record, status: "failed", lastError: String(error), updatedAt: Date.now() });
  }
}

export async function markVoucherPending(id, error) {
  const db = await dbPromise;
  const record = await db.get(STORE, id);
  if (record) {
    await db.put(STORE, { ...record, status: "pending", lastError: String(error), updatedAt: Date.now() });
  }
}

export async function removeVoucher(id) { return (await dbPromise).delete(STORE, id); }

export async function updateVoucherStatus(id, status, extras = {}) {
  const db = await dbPromise;
  const record = await db.get(STORE, id);
  if (!record) return null;
  const next = { ...record, ...extras, status, updatedAt: Date.now() };
  await db.put(STORE, next);
  return next;
}