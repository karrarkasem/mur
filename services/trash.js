import { auth, db } from "./firebase.js";
import {
  addDoc, collection, doc, setDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Every delete across the app goes through here instead of deleteDoc
// directly: it snapshots the document into `deletedItems` (audit trail -
// who deleted what, when) before removing it, so it can be restored later.

export async function moveToTrash(sourceCollection, sourceId, data) {
  await addDoc(collection(db, "deletedItems"), {
    sourceCollection,
    sourceId,
    data,
    deletedBy: auth.currentUser?.email || null,
    deletedByUid: auth.currentUser?.uid || null,
    deletedAt: serverTimestamp(),
    status: "trashed"
  });
  await deleteDoc(doc(db, sourceCollection, sourceId));
}

export function addTrashOpsToBatch(batch, sourceCollection, sourceId, data) {
  batch.set(doc(collection(db, "deletedItems")), {
    sourceCollection,
    sourceId,
    data,
    deletedBy: auth.currentUser?.email || null,
    deletedByUid: auth.currentUser?.uid || null,
    deletedAt: serverTimestamp(),
    status: "trashed"
  });
  batch.delete(doc(db, sourceCollection, sourceId));
}

export async function restoreFromTrash(trashId, sourceCollection, sourceId, data) {
  await setDoc(doc(db, sourceCollection, sourceId), data);
  await updateDoc(doc(db, "deletedItems", trashId), {
    status: "restored",
    restoredBy: auth.currentUser?.email || null,
    restoredAt: serverTimestamp()
  });
}

export async function purgeFromTrash(trashId) {
  await deleteDoc(doc(db, "deletedItems", trashId));
}
