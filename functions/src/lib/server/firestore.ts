import { getFirestore, type CollectionReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { HttpError } from './http.js';

export function cleanSheetRecords(db: Firestore = getFirestore(), scenario = process.env.CLEANSHEET_SCENARIO_ID ?? 'demo') {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(scenario)) {
    throw new HttpError(503, 'STORE_UNAVAILABLE', 'The data store is not configured.');
  }
  const namespace = db.collection('scenarios').doc(scenario);
  const collection = (name: string): CollectionReference => namespace.collection(name);
  const ref = (name: string, id: string) => collection(name).doc(encodeURIComponent(id));
  async function read<T>(name: string, id: string, tx?: Transaction): Promise<T | undefined> {
    const document = ref(name, id);
    return (tx ? await tx.get(document) : await document.get()).data() as T | undefined;
  }
  return { db, scenario, collection, ref, read };
}

export type Records = ReturnType<typeof cleanSheetRecords>;
