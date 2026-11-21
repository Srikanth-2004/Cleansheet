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
firebase deploy --project cleansheet-buildathon --only functions:api,functions:billingEvents
```

For a new database dedicated to CleanSheet, deploy `firebase deploy --project cleansheet-buildathon --only firestore:rules` to keep browser clients out of the database. If the project has existing Firestore rules, merge the intended CleanSheet policy with the existing rules before publishing them. Keep the Admin SDK service account permissions narrowly scoped.

The browser API health check is `GET <api-url>/health`. Application paths are relative to the function's deploy URL, for example `GET <api-url>/api/me`. Send the signed-in Firebase user's ID token as `Authorization: Bearer <token>`. Set `CLEANSHEET_CORS_ORIGINS` to the team's comma-separated frontend origins when they are known.

Firestore stores each team's test scenario in `scenarios/{scenario}`. Seed the browser role mappings after creating the two demo Firebase Auth users. Load the seed variables listed in [functions/.env.example](functions/.env.example) as shell variables and use Application Default Credentials with permission to read those test Auth users and write Firestore.

```powershell
npm --prefix functions run seed:demo -- demo 2026-11
```

Store Cashfree Payment Gateway and Secure ID Sandbox credentials as separate JSON objects with keys `clientId` and `clientSecret` in Secret Manager. Set `CLEANSHEET_CASHFREE_PG_SECRET` and `CLEANSHEET_SECURE_ID_SECRET` to their version resources, such as `projects/cleansheet-buildathon/secrets/cleansheet-secure-id/versions/latest`. Grant the `api` function's runtime service account access to those secrets.

Store the Sarvam API key as a text secret and set `CLEANSHEET_SARVAM_SECRET` to that secret's version resource. Grant access to the same Firebase runtime service account.

## Run the existing frontend

Copy the root `.env.example` to `.env.local` and set the Firebase web app API key. Enable Google sign-in and authorize `localhost` in Firebase Auth. Next.js forwards application routes to `NEXT_PUBLIC_API_BASE_URL` under the same browser origin. Firebase verifies the caller's role and runs the provider calls.

```powershell
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Integration handoff

- **Cashfree** signs and verifies raw provider callbacks in the Cashfree adapter. The trusted adapter sends normalized events via `POST <billingEvents-url>/`. Its service account needs Cloud Run Invoker on this private service and a Google-signed ID token addressed to the function URL. Supported event types are `payment.succeeded`, `subscription.payment`, `subscription.cancelled`, `refund.requested`, and `refund.updated`. The [event schema](functions/src/events.ts) lists the fields and allowed values. Checkout reservation and verification use `createFeeStore` server-side.
- **Relay and Sarvam** use the billing action and outreach records. The backend writes `schedule_charge`, `cancel_subscription`, and `issue_refund` to `scenarios/{scenario}/billingActions`. The `outreach` collection holds reviewable call and link-delivery intents. The Relay adapter owns approved dispatch and rechecks authorization, consent and current billing state before outreach. The coach summary runs the scoped `get_fee_summary` MCP tool. Use `withCoachFeeMcp` inside a server-side voice session bound to the verified coach.
- **Frontend** runs locally and uses the existing browser routes with Firebase ID tokens. The function exposes identity, fees, checkout, payment verification, billing, refunds and the Sarvam-powered Raz preview. The Cashfree owner still supplies subscription enrolment and raw provider callbacks.
