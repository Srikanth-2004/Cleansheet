# CleanSheet Firebase backend

CleanSheet uses TypeScript on 2nd gen Firebase HTTPS Functions with Node.js 26 (preview), Firebase Auth, and Cloud Firestore. The functions run in Mumbai (`asia-south1`) and the configured project is `cleansheet-buildathon`.

| Folder or file | Purpose |
| --- | --- |
| `functions/src/index.ts` | HTTPS exports for the browser API and the private billing event gateway |
| `functions/src/contracts/` | Shared billing, subscription, and refund types |
| `functions/src/lib/server/` | Firestore transactions, the coach MCP tool, and Secure ID verification |
| `functions/scripts/` | Demo actor seeding and the full emulator smoke check |
| `firebase.json`, `.firebaserc`, `firestore.rules` | Firebase runtime, project, emulator, and data-access configuration |

## Start locally

Use Node.js 26, Firebase CLI 15.37.0 or newer, and Java 21 for the Firestore emulator.

```powershell
npm install -g firebase-tools
npm --prefix functions ci
npm --prefix functions run typecheck
npm --prefix functions test
npm --prefix functions run build
firebase emulators:exec --project demo-cleansheet --only auth,firestore,functions "node --import ./functions/node_modules/tsx/dist/loader.mjs ./functions/scripts/emulator-smoke.ts"
```

## Deploy

Sign into Firebase as a project member with deployment access. The project needs the Blaze plan, a default Firestore database, and an enabled Firebase Auth sign-in provider. Use the existing Firebase configuration in this folder.

```powershell
firebase login
firebase deploy --project cleansheet-buildathon --only functions:api,functions:billingEvents,functions:billingOperations
```

For a new database dedicated to CleanSheet, deploy `firebase deploy --project cleansheet-buildathon --only firestore:rules` to keep browser clients out of the database. If the project has existing Firestore rules, merge the intended CleanSheet policy with the existing rules before publishing them. Keep the Admin SDK service account permissions narrowly scoped.

The browser API health check is `GET <api-url>/health`. Application paths are relative to the function's deploy URL, for example `GET <api-url>/api/me`. Send the signed-in Firebase user's ID token as `Authorization: Bearer <token>`. Set `CLEANSHEET_CORS_ORIGINS` to the team's comma-separated frontend origins when they are known.

Firestore stores each team's test scenario in `scenarios/{scenario}`. Seed the browser role mappings after creating the two demo Firebase Auth users. Load the seed variables listed in [functions/.env.example](functions/.env.example) as shell variables and use Application Default Credentials with permission to read those test Auth users and write Firestore.

```powershell
npm --prefix functions run seed:demo -- demo 2026-11
```

For local development, the seed creates emulator-only coach and parent accounts, a ₹1,500 unpaid fee, and a sample subscription cycle. Run it twice to check that it preserves existing data, or reuse the exported snapshot.

```powershell
firebase emulators:exec --project demo-cleansheet --only auth,firestore --export-on-exit .firebase/seeded "npm --prefix functions run seed:demo -- demo 2026-11 --emulator"
firebase emulators:start --project demo-cleansheet --only auth,firestore,functions --import .firebase/seeded
```

The local fixture accounts are `coach@example.test` and `parent@example.test`, both with password `local-cleansheet-demo`. The cloud seed checks Firebase Auth for the two enabled accounts before writing their role mappings and unpaid fee. Use the selected project's ADC and approved test-parent contact. It preserves existing documents and creates sample mandate state only in the emulator.

On a new cloud demo project, `npm --prefix functions run seed:demo -- demo 2026-11 --sample` creates a fixture coach, fixture parent, and unpaid fee without passwords, a customer phone, or provider references. Set `CLEANSHEET_FIREBASE_PROJECT_ID` explicitly and use authorized ADC for that project.

Store Cashfree Payment Gateway and Secure ID Sandbox credentials as separate JSON objects with keys `clientId` and `clientSecret` in Secret Manager. Set `CLEANSHEET_CASHFREE_PG_SECRET` and `CLEANSHEET_SECURE_ID_SECRET` to their version resources, such as `projects/cleansheet-buildathon/secrets/cleansheet-secure-id/versions/latest`. Grant the `api` function's runtime service account access to those secrets.

Set `CLEANSHEET_SUBSCRIPTION_PLAN_ID` to an existing Sandbox on-demand INR plan. Set `CLEANSHEET_CASHFREE_SUBSCRIPTIONS_SECRET` if the subscription account uses separate credentials. Put Payouts Sandbox credentials in their own Secret Manager resource and set `CLEANSHEET_CASHFREE_PAYOUTS_SECRET` on the backend. The `billingOperations` runtime needs access to the Subscriptions and Payouts secrets. Grant Cloud Run Invoker on `billingOperations` only to authorized billing operators or their service account.

Store the Sarvam API key as a text secret and set `CLEANSHEET_SARVAM_SECRET` to that secret's version resource. Grant access to the same Firebase runtime service account.

## Run the existing frontend

Copy the root `.env.example` to `.env.local` and set the Firebase web app API key. Enable Google sign-in and authorize `localhost` in Firebase Auth. Next.js forwards application routes to `NEXT_PUBLIC_API_BASE_URL` under the same browser origin. Firebase verifies the caller's role and runs the provider calls.

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Integration handoff

- **Payment Gateway** uses stored fee amounts for checkout and reconciles signed successful payments at `POST <api-url>/api/webhooks/cashfree/pg`. Requests verify the signature over the raw body. Provider-confirmed amounts and references must match the stored order.
- **Subscriptions** receive mandate and charge events at `POST <api-url>/api/webhooks/cashfree/subscriptions`. A linked parent with a Secure ID verified contact can enrol and open hosted checkout with the returned `subscriptionSessionId`. Billing operators prepare a cycle using `POST <billingOperations-url>/subscriptions/cycles` with `playerId`, `period`, `dueAt` and `cutoffAt`. They run an approved charge or cancellation with `POST <billingOperations-url>/subscriptions/actions/<actionId>`. Parent keep is required before charging. The pilot requires at least 24 hours of lead time before the scheduled debit. A failed charge webhook leaves the cycle eligible for provider retries. The private event gateway can record confirmed final failure after the operator verifies that retries are exhausted.
- **Payouts** use a separate approval record at `scenarios/{scenario}/payouts/{id}`. An operator records `{status: 'approved', approvedBy, beneficiaryId, amountPaise}` for an existing Sandbox beneficiary, then calls `POST <billingOperations-url>/payouts/<id>/submit`. Use `POST <billingOperations-url>/payouts/<id>/reconcile` after a timeout or pending response. Retries look up the same transfer ID. A received transfer stays pending until Cashfree reports completion.
- **Relay and Sarvam** use the outreach records. A scoped coach approves the action via `POST /api/coach/billing/outreach/<actionId>/approve`. An operator uses the private `/relay/<actionId>/handoff` route to recheck current eligibility before a merchant dashboard action, then records the observed provider reference and outcome at `/relay/<actionId>/outcome`. Cashfree Relay account access and an approved workflow are needed for live dispatch. Recovery also needs an approved link mapped to the cycle.
- **MCP** runs `get_fee_summary` inside the Firebase function. The verified coach determines the player scope and the tool reads Firestore fresh for the requested month. Use `withCoachFeeMcp` inside an authenticated server-side voice session.
- **Private events** accepts normalized verified payment, subscription and refund events at `POST <billingEvents-url>/`. Outbound refund submission is a separate provider action. The [event schema](functions/src/events.ts) lists the fields and allowed values.
