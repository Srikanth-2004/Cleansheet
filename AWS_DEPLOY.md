# AWS Lambda backend

The TypeScript API runs as an AWS Lambda **Event function** on Node.js 22.x behind API Gateway. Cognito signs in test users, and DynamoDB stores roles, linked fees, checkout reservations, payments and coach notifications. The SAM template packages the `lambda.handler` entry point in `dist/api/`.

## Run and deploy

```sh
npm ci
npm run typecheck
npm test
npm run build
sam deploy --guided
```

Use an authorised AWS profile and choose a unique `CognitoDomainPrefix`. `ApiUrl` is the backend endpoint. Set `CognitoCallbackUrl` to the exact callback supplied by the Frontend owner and `FrontendOrigin` to that team's HTTPS origin for CORS. For local callback testing, the template defaults to `http://localhost:3000/`. Cognito clients use authorization code with PKCE and send the **access token** to protected requests. The public endpoint is `/health`.

For Secure ID, set `SecureIdSecretArn` to an approved Secrets Manager secret with `clientId` and `clientSecret` for Cashfree Secure ID Sandbox. The deployment identity needs read access to resolve the secret. `POST /api/parent/contact/start` sends an OTP only to the adult number already linked to the account. `POST /api/parent/contact/verify` confirms the active challenge. Tests use stubbed provider responses. Run sandbox verification with the event account before enabling outreach.

Create the two approved test users in the Cognito pool and record their `sub` values. Set `CLEANSHEET_DYNAMODB_TABLE` from the stack output, `CLEANSHEET_SCENARIO_ID` to the deployed scenario, `CLEANSHEET_COACH_SUB`, `CLEANSHEET_PARENT_SUB`, and the approved sandbox `CLEANSHEET_TEST_PARENT_EMAIL` and `CLEANSHEET_TEST_PARENT_PHONE` in the local shell. Use the same region and AWS profile as the stack. Then run one of the following.

```sh
npm run seed:demo -- smoke 2026-11
npm run seed:demo -- fresh 2026-11
```

Run each seed against its own scenario ID. The transaction refuses to overwrite existing scenario data. `smoke` provides an unpaid fee for PG checkout. `fresh` leaves fee creation to the coach.

## Integration handoff

- Frontend can use `GET /api/me`, `GET /api/parent/fees?period=YYYY-MM`, `GET /api/coach/summary?period=YYYY-MM`, `POST /api/coach/fees`, and `GET /api/coach/billing/notifications`.
- Parent billing also exposes `GET /api/parent/billing`, `POST /api/parent/outreach-consent`, and `POST /api/parent/billing/cycles/[id]/decision`. Keep/cancel writes a durable intent and never submits a provider request by itself. The subscription integration must supply the scoped mandate and current cycle records before those choices can be exercised.
- Cashfree can use `getActor(event, store, 'parent')` and `createDynamoFeeStore()` with `reserveCheckout`, `getCheckout` and `applyVerifiedPayment`. Verify provider order, payment status, amount, currency and sandbox environment before applying. A verified PG payment writes the ledger change and coach notification in one DynamoDB transaction.
- Sarvam can use `getActor(event, store, 'coach')` and the scoped fee summary routine. Keep the model and Relay away from direct table credentials.
- Add authenticated adapter paths to `src/lambda.ts` as they land. When signing checks and the event contract are in place, add specific API Gateway webhook routes with provider authentication. Use the Relay backend plan for subscriptions, cancellation, recovery, Secure ID and refunds.
