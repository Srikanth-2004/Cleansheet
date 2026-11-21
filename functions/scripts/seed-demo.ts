import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { DEFAULT_MONTHLY_FEE_PAISE, isPeriod, type Actor, type Fee } from '../src/contracts/billing.js';
import { getCoachFeeSummaryViaMcp } from '../src/lib/server/fee-mcp.js';
import { createFeeStore } from '../src/lib/server/fee-store.js';
import { cleanSheetRecords } from '../src/lib/server/firestore.js';

const env = process.env;
const [scenario, period, option] = process.argv.slice(2);
const emulator = option === '--emulator';
const sample = option === '--sample';
const demoIdentities = emulator || sample;
const projectId = emulator ? 'demo-cleansheet' : env.CLEANSHEET_FIREBASE_PROJECT_ID;
const coachUid = demoIdentities ? 'demo-coach' : env.CLEANSHEET_COACH_UID;
const parentUid = demoIdentities ? 'demo-parent' : env.CLEANSHEET_PARENT_UID;
const email = demoIdentities ? 'parent@example.test' : env.CLEANSHEET_TEST_PARENT_EMAIL;
const phone = emulator ? '9999999999' : sample ? undefined : env.CLEANSHEET_TEST_PARENT_PHONE;
const hasEmulator = Boolean(env.FIREBASE_AUTH_EMULATOR_HOST || env.FIRESTORE_EMULATOR_HOST);
const localHost = /^(127\.0\.0\.1|localhost):\d+$/;
if (!projectId || !scenario || !isPeriod(period) || !coachUid || !parentUid || coachUid === parentUid || !email || (!phone && !sample)
  || (option && !demoIdentities) || (sample && scenario !== 'demo') || emulator !== hasEmulator
  || (emulator && (!localHost.test(env.FIREBASE_AUTH_EMULATOR_HOST ?? '') || !localHost.test(env.FIRESTORE_EMULATOR_HOST ?? '')))) {
  throw new Error('Provide a scenario and YYYY-MM, then choose a local Emulator Suite or configure the cloud project and two approved Firebase Auth users.');
}

initializeApp({ projectId });
const auth = getAuth();
if (demoIdentities) {
  for (const [uid, address] of [[coachUid, 'coach@example.test'], [parentUid, email]]) {
    try {
      await auth.getUser(uid);
    } catch (error) {
      if ((error as { code?: string }).code !== 'auth/user-not-found') throw error;
      await auth.createUser({ uid, email: address, ...(emulator ? { password: 'local-cleansheet-demo' } : {}) });
    }
  }
}
const users = await Promise.all([auth.getUser(coachUid), auth.getUser(parentUid)]);
if (users.some(user => user.disabled) || users[1].email?.toLowerCase() !== email.toLowerCase()) {
  throw new Error('Use enabled test accounts and the parent email registered on the selected Firebase Auth account.');
}

const records = cleanSheetRecords(undefined, scenario);
const scope = { academyName: 'First Touch Academy', teamName: 'U12', playerId: 'demo-player', playerName: 'Demo Player' };
const coach: Actor = { ...scope, uid: coachUid, role: 'coach' };
const parent: Actor = {
  ...scope, uid: parentUid, role: 'parent',
  ...(phone ? { customer: { id: 'cleansheet-demo-parent', name: 'Demo Parent', email, phone } } : {}),
};
const fee: Fee = {
  id: `${scope.playerId}-${period}`, playerId: scope.playerId, playerName: scope.playerName,
  period, amountPaise: DEFAULT_MONTHLY_FEE_PAISE, currency: 'INR', status: 'unpaid',
};
const cycleId = `${scope.playerId}-${period}`;
const dueAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
const cutoffAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
const documents = [
  { ref: records.ref('actors', coach.uid), data: coach },
  { ref: records.ref('actors', parent.uid), data: parent },
  { ref: records.ref('fees', fee.id), data: fee },
  ...(emulator ? [
    { ref: records.ref('subscriptions', scope.playerId), data: {
      id: 'fixture-mandate', status: 'active', currentCycleId: cycleId, nextDueAt: dueAt, coachUid, parentUid,
    } },
    { ref: records.ref('cycles', cycleId), data: {
      id: cycleId, playerId: scope.playerId, parentUid, period, amountPaise: fee.amountPaise,
      dueAt, cutoffAt, status: 'awaiting_decision', recoveryUrl: null,
    } },
  ] : []),
];
await records.db.runTransaction(async tx => {
  const [existingCoach, existingParent] = await Promise.all([
    tx.get(records.collection('actors').where('role', '==', 'coach').where('playerId', '==', scope.playerId)),
    tx.get(records.collection('actors').where('role', '==', 'parent').where('playerId', '==', scope.playerId)),
  ]);
  if (existingCoach.docs.some(snapshot => snapshot.data().uid !== coachUid)
    || existingParent.docs.some(snapshot => snapshot.data().uid !== parentUid)) {
    throw new Error('This scenario already has a different linked coach or parent.');
  }
  const snapshots = await tx.getAll(...documents.map(({ ref }) => ref));
  for (const [index, snapshot] of snapshots.entries()) {
    const document = documents[index];
    if (!snapshot.exists) tx.create(document.ref, document.data);
    else if (index < 2 && (snapshot.data()?.role !== [coach.role, parent.role][index] || snapshot.data()?.playerId !== scope.playerId)) {
      throw new Error('An existing actor has a different role or player scope.');
    }
  }
});
const summary = await getCoachFeeSummaryViaMcp(coach, createFeeStore(records), period);
console.log(`Verified ${scenario} in ${projectId} for ${period}. MCP returned ${JSON.stringify(summary)}`);
