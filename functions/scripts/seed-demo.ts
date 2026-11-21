import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Actor, Fee } from '../src/contracts/billing.js';
import { isPeriod } from '../src/contracts/billing.js';
import { cleanSheetRecords } from '../src/lib/server/firestore.js';

const env = process.env;
const projectId = env.CLEANSHEET_FIREBASE_PROJECT_ID ?? env.GCLOUD_PROJECT;
const [scenario, period] = process.argv.slice(2);
const coachUid = env.CLEANSHEET_COACH_UID;
const parentUid = env.CLEANSHEET_PARENT_UID;
const email = env.CLEANSHEET_TEST_PARENT_EMAIL;
const phone = env.CLEANSHEET_TEST_PARENT_PHONE;
if (!projectId || !scenario || !isPeriod(period) || !coachUid || !parentUid || coachUid === parentUid || !email || !phone) {
  throw new Error('Set the project, two Firebase Auth UIDs and approved test-parent contact, then provide a scenario and YYYY-MM.');
}
if (getApps().length === 0) initializeApp({ projectId });
await Promise.all([getAuth().getUser(coachUid), getAuth().getUser(parentUid)]);
const records = cleanSheetRecords(undefined, scenario);
const scope = { academyName: 'First Touch Academy', teamName: 'U12', playerId: 'demo-player', playerName: 'Demo Player' };
const coach: Actor = { ...scope, uid: coachUid, role: 'coach' };
const parent: Actor = {
  ...scope, uid: parentUid, role: 'parent',
  customer: { id: 'cleansheet-demo-parent', name: 'Demo Parent', email, phone },
};
const fee: Fee = {
  id: `${scope.playerId}-${period}`, playerId: scope.playerId, playerName: scope.playerName,
  period, amountPaise: 150000, currency: 'INR', status: 'unpaid',
};
const batch = records.db.batch();
batch.create(records.ref('actors', coach.uid), coach);
batch.create(records.ref('actors', parent.uid), parent);
if (scenario === 'smoke') batch.create(records.ref('fees', fee.id), fee);
await batch.commit();
console.log(`Seeded ${scenario} in ${projectId} for ${period}.`);
