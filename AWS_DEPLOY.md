# AWS Lambda backend and app hosting

The TypeScript Lambda serves both the browser bundle in `web/` and JSON routes behind API Gateway. Cognito signs in test users, and DynamoDB stores their role, linked fee, checkout reservation, payment and coach notification. The SAM template provisions these resources together. Frontend can replace `web/index.html` and supply browser JS, CSS, and media under `web/assets/`. Compile browser TypeScript before copying the output into `web/`.

## Run and deploy

```sh
npm ci
npm run typecheck
npm test
npm run build
sam deploy --guided
```

Use an authorised AWS profile and choose a unique `CognitoDomainPrefix`. For the first stack deployment, the default localhost callback satisfies client creation. Redeploy with `CognitoCallbackUrl` set to the exact `AppUrl` output before testing hosted sign-in. Use Cognito's authorization-code flow with PKCE at the app origin and send the **access token** to protected requests. The hosted API supports the public shell, assets and `/health`. There is no public data or webhook route in this backend slice.

Create the two approved test users in the Cognito pool and record their `sub` values. Set `CLEANSHEET_DYNAMODB_TABLE` from the stack output, `CLEANSHEET_SCENARIO_ID` to the deployed scenario, `CLEANSHEET_COACH_SUB`, `CLEANSHEET_PARENT_SUB`, and the approved sandbox `CLEANSHEET_TEST_PARENT_EMAIL` and `CLEANSHEET_TEST_PARENT_PHONE` in the local shell. Use the same region and AWS profile as the stack. Then run one of the following.

```sh
npm run seed:demo -- smoke 2026-11
npm run seed:demo -- fresh 2026-11
```

Run each seed against its own scenario ID. The transaction refuses to overwrite existing scenario data. `smoke` provides an unpaid fee for PG checkout. `fresh` leaves fee creation to the coach.

## Integration handoff

- Frontend can use `GET /api/me`, `GET /api/parent/fees?period=YYYY-MM`, `GET /api/coach/summary?period=YYYY-MM`, `POST /api/coach/fees`, and `GET /api/coach/billing/notifications`.
- Cashfree can use `getActor(event, store, 'parent')` and `createDynamoFeeStore()` with `reserveCheckout`, `getCheckout` and `applyVerifiedPayment`. Verify provider order, payment status, amount, currency and sandbox environment before applying. A verified PG payment writes the ledger change and coach notification in one DynamoDB transaction.
- Sarvam can use `getActor(event, store, 'coach')` and the scoped fee summary routine. Keep the model and Relay away from direct table credentials.
- Add authenticated adapter paths to `src/lambda.ts` as they land. When signing checks and the event contract are in place, add specific API Gateway webhook routes with provider authentication. Use the Relay backend plan for subscriptions, cancellation, recovery, Secure ID and refunds.
