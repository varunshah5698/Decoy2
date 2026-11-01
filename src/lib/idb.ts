/** Minimal promise-based IndexedDB key/value store used for dataset payloads.
    Local storage caps around 5 MB and would drop a real inventory export, so uploads
    keep full row fidelity in IndexedDB and fall back to local storage only when the
    database is unavailable (private browsing, older engines). */

const DB_NAME = 'aegis-sentinel'
const STORE = 'datasets'

let handle: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (handle) return handle
  handle = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    try {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        const database = request.result
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return handle
}

function transaction(mode: IDBTransactionMode): Promise<IDBObjectStore | null> {
  return open().then((database) => (database ? database.transaction(STORE, mode).objectStore(STORE) : null))
}

export async function idbGet(key: string): Promise<string | null> {
  const store = await transaction('readonly')
  if (!store) return localStorage.getItem(key)
  return new Promise((resolve) => {
    try {
      const request = store.get(key)
      request.onsuccess = () => resolve(request.result == null ? null : String(request.result))
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function idbSet(key: string, value: string): Promise<void> {
  const store = await transaction('readwrite')
  if (!store) {
    localStorage.setItem(key, value)
    return
  }
  await new Promise<void>((resolve) => {
    try {
      const request = store.put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

export async function idbRemove(key: string): Promise<void> {
  const store = await transaction('readwrite')
  if (!store) {
    localStorage.removeItem(key)
    return
  }
  await new Promise<void>((resolve) => {
    try {
      const request = store.delete(key)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

export const idbStorage: Storage = {
  get length() {
    return 0
  },
  key: () => null,
  /* Reads must hit IndexedDB: setItem writes there, so a localStorage read would always
     rehydrate an empty store and drop every accepted dataset on the next page load. */
  getItem: (name: string) => idbGet(name) as unknown as string | null,
  setItem: (name: string, value: string) => void idbSet(name, value),
  removeItem: (name: string) => void idbRemove(name),
  clear: () => void idbRemove('aegis.uploads'),
}
