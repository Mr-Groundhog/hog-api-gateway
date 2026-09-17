/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import type { GalleryEntry, GalleryRecord } from '../types'
import { selectRetained } from './gallery-retention'

const DB_NAME = 'new-api-image-studio'
const DB_VERSION = 1
const STORE_NAME = 'gallery'

/** Promise form of one IndexedDB request. */
function toPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => reject(request.error))
  })
}

/** Resolve once the transaction has committed; reject if it never will. */
function settled(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve())
    transaction.addEventListener('abort', () => reject(transaction.error))
    transaction.addEventListener('error', () => reject(transaction.error))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.addEventListener('upgradeneeded', () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    })
    request.addEventListener('success', () => resolve(request.result))
    request.addEventListener('error', () => reject(request.error))
  })
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDatabase()
  try {
    const transaction = db.transaction(STORE_NAME, mode)
    const result = await toPromise(run(transaction.objectStore(STORE_NAME)))
    // Closing before the commit would abort the write.
    await settled(transaction)
    return result
  } finally {
    db.close()
  }
}

function readAll(): Promise<GalleryRecord[]> {
  return runTransaction<GalleryRecord[]>('readonly', (store) => store.getAll())
}

/** Save one generation, pruning expired entries as a side effect. */
export async function saveGalleryEntry(entry: GalleryEntry): Promise<void> {
  const record: GalleryRecord = { ...entry, createdAt: Date.now() }
  await runTransaction('readwrite', (store) => store.put(record))
  await pruneGallery()
}

/** List the gallery newest first, having first dropped expired entries. */
export async function listGalleryEntries(): Promise<GalleryRecord[]> {
  await pruneGallery()
  const records = await runTransaction<GalleryRecord[]>('readonly', (store) =>
    store.getAll()
  )
  return records.sort((left, right) => right.createdAt - left.createdAt)
}

/** Remove expired and over-cap entries; returns how many were dropped. */
export async function pruneGallery(): Promise<number> {
  const { droppedIds } = selectRetained(await readAll(), Date.now())
  if (droppedIds.length === 0) {
    return 0
  }
  await runTransaction('readwrite', (store) => {
    for (const id of droppedIds) {
      store.delete(id)
    }
    return store.count()
  })
  return droppedIds.length
}

/** Delete one entry. */
export async function deleteGalleryEntry(id: string): Promise<void> {
  await runTransaction('readwrite', (store) => store.delete(id))
}

/** Delete every entry. */
export async function clearGallery(): Promise<void> {
  await runTransaction('readwrite', (store) => store.clear())
}
