const storage = ['CLEANSHEET_DYNAMODB_TABLE', 'CLEANSHEET_SCENARIO_ID'];
const required = {
  api: storage,
  seed: [
    'AWS_REGION', ...storage, 'CLEANSHEET_COACH_SUB', 'CLEANSHEET_PARENT_SUB',
    'CLEANSHEET_TEST_PARENT_EMAIL', 'CLEANSHEET_TEST_PARENT_PHONE',
  ],
  'secure-id': ['CASHFREE_SECURE_ID_CLIENT_ID', 'CASHFREE_SECURE_ID_CLIENT_SECRET'],
};

const scope = process.argv[2] ?? 'seed';
if (!Object.hasOwn(required, scope)) {
  console.error('Choose api, seed, or secure-id.');
  process.exitCode = 1;
} else {
  const missing = required[scope].filter(name => !process.env[name]?.trim());
  if (missing.length) {
    console.error(`Missing ${scope} configuration: ${missing.join(', ')}`);
    process.exitCode = 1;
  } else {
    console.log(`Required ${scope} variable names are set. This check makes no provider calls.`);
  }
}
