import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { isPeriod, type Actor, type Fee } from '../src/contracts/billing.js';
import { documentClient, getStorageConfig } from '../src/lib/server/dynamo-store.js';

const { table, pk } = getStorageConfig();
const coachSub = process.env.CLEANSHEET_COACH_SUB;
const parentSub = process.env.CLEANSHEET_PARENT_SUB;
const parentPhone = process.env.CLEANSHEET_TEST_PARENT_PHONE;
const parentEmail = process.env.CLEANSHEET_TEST_PARENT_EMAIL;
const scenario = process.argv[2];
const period = process.argv[3];
if (!coachSub || !parentSub || coachSub === parentSub || !parentPhone || !parentEmail
  || !['smoke', 'fresh'].includes(scenario) || !isPeriod(period)) {
  throw new Error('Provide two Cognito subjects, the approved test parent contact, and arguments smoke|fresh YYYY-MM.');
}

const scope = { academyName: 'First Touch Academy', teamName: 'U12', playerId: 'demo-player', playerName: 'Demo Player' };
const coach: Actor = { ...scope, uid: coachSub, role: 'coach' };
const parent: Actor = {
  ...scope, uid: parentSub, role: 'parent',
  customer: { id: parentSub, name: 'Demo Parent', email: parentEmail, phone: parentPhone },
};
const fee: Fee = {
  id: `${scope.playerId}-${period}`, playerId: scope.playerId, playerName: scope.playerName,
  period, amountPaise: 150000, currency: 'INR', status: 'unpaid',
};
const records = [{ pk, sk: `ACTOR#${coachSub}`, ...coach }, { pk, sk: `ACTOR#${parentSub}`, ...parent }];
const items = scenario === 'smoke' ? [...records, { pk, sk: `FEE#${fee.id}`, ...fee }] : records;
await documentClient.send(new TransactWriteCommand({
  TransactItems: items.map(Item => ({ Put: { TableName: table, Item, ConditionExpression: 'attribute_not_exists(pk)' } })),
}));
console.log(`Seeded ${scenario} fixture for ${period}.`);
