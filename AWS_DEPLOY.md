# AWS Lambda backend

The TypeScript API runs as an AWS Lambda **Event function** on Node.js 26 (`nodejs26.x`) behind API Gateway. Cognito signs in test users, and DynamoDB stores roles, linked fees, checkout reservations, payments and coach notifications. The SAM template packages the `lambda.handler` entry point in `dist/api/`. AWS lists Node.js 26 as a preview runtime for the sandbox sprint. [AWS Lambda runtimes](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html)

## Run and deploy

```sh
node --version
npm ci
npm run typecheck
npm test
npm run build
sam deploy --guided
```

Use Node.js 26 locally and an authorised AWS profile for SAM. Choose a unique `CognitoDomainPrefix`. `ApiUrl` is the backend endpoint. Set `CognitoCallbackUrl` to the exact callback supplied by the Frontend owner and `FrontendOrigin` to that team's HTTPS origin for CORS. For local callback testing, the template defaults to `http://localhost:3000/`. Cognito clients use authorization code with PKCE and send the **access token** to protected requests. The public endpoint is `/health`.

For Secure ID, set `SecureIdSecretArn` to an approved Secrets Manager secret with `clientId` and `clientSecret` for Cashfree Secure ID Sandbox. The deployment identity needs read access to resolve the secret. `POST /api/parent/contact/start` sends an OTP only to the adult number already linked to the account. `POST /api/parent/contact/verify` confirms the active challenge. Tests use stubbed provider responses. Run sandbox verification with the event account before enabling outreach.

## Local `.env` and AWS resources

Copy [`.env.example`](.env.example) to `.env` at the repository root. `npm run config:check -- seed` checks required names without printing their values. `seed:demo` loads `.env` automatically. Keep real `.env` files local. AWS SAM uses the AWS credentials available to its shell or configured profile.

| Names | Value and use |
|---|---|
| `AWS_REGION`, `AWS_PROFILE` | Stack region and local deployment/seed profile. The template example uses `ap-south-1` as a starting value. `AWS_PROFILE` may be omitted for a configured default profile. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` | Optional temporary AWS session credentials for local commands if the event gives you a session instead of a profile. Lambda uses its execution role. |
| `CLEANSHEET_DYNAMODB_TABLE`, `CLEANSHEET_SCENARIO_ID` | Deployed `DynamoTable` output and the selected scenario such as `smoke`. Both are required for the API and seed. |
| `CLEANSHEET_COACH_SUB`, `CLEANSHEET_PARENT_SUB` | Distinct Cognito `sub` values for the approved test coach and parent. Used by seed. |
| `CLEANSHEET_TEST_PARENT_EMAIL`, `CLEANSHEET_TEST_PARENT_PHONE` | Approved adult sandbox contact for Secure ID and the approved recovery demonstration. Used by seed. |
| `CASHFREE_SECURE_ID_CLIENT_ID`, `CASHFREE_SECURE_ID_CLIENT_SECRET` | Secure ID Sandbox credentials for local contact endpoint validation. The deployed function reads the `clientId` and `clientSecret` keys from `SecureIdSecretArn` at stack deployment. |

For a manual Lambda deployment, package only `dist/api/` with `lambda.js` at the ZIP root. Select x86_64, 256 MB and a 15-second timeout. Use a DynamoDB table with string partition key `pk` and sort key `sk`. The execution role needs CloudWatch Logs and `GetItem`, `Query`, `PutItem`, `UpdateItem` and `ConditionCheckItem` on that table. Connect an API Gateway HTTP API with payload format 2.0 and Cognito JWT auth on `/api/{proxy+}`. SAM creates these resources and routes.

Create the two approved test users in the Cognito pool, populate the seed values, and choose a scenario.

```sh
npm run config:check -- seed
npm run seed:demo -- smoke 2026-11
npm run seed:demo -- fresh 2026-11
```

Run each seed against its own scenario ID. The transaction refuses to overwrite existing scenario data. `smoke` provides an unpaid fee for PG checkout. `fresh` leaves fee creation to the coach.

## Integration handoff

- Frontend can use `GET /api/me`, `GET /api/parent/fees?period=YYYY-MM`, `GET /api/coach/summary?period=YYYY-MM`, `POST /api/coach/fees`, and `GET /api/coach/billing/notifications`.
- Parent billing also exposes `GET /api/parent/billing`, `POST /api/parent/outreach-consent`, and `POST /api/parent/billing/cycles/[id]/decision`. Keep/cancel writes a durable intent and never submits a provider request by itself. The subscription integration must supply the scoped mandate and current cycle records before those choices can be exercised.
- Cashfree can use `getActor(event, store, 'parent')` and `createDynamoFeeStore()` with `reserveCheckout`, `getCheckout` and `applyVerifiedPayment`. Verify provider order, payment status, amount, currency and sandbox environment before applying. A verified PG payment writes the ledger change and coach notification in one DynamoDB transaction.
- Sarvam can use `getActor(event, store, 'coach')` and the [coach MCP tool](#coach-mcp-tool). Keep the model and Relay away from direct table credentials.
- Add authenticated adapter paths to `src/lambda.ts` as they land. When signing checks and the event contract are in place, add specific API Gateway webhook routes with provider authentication. Use the Relay backend plan for subscriptions, cancellation, recovery, Secure ID and refunds.

## Billing and refund handoffs

- `GET /api/coach/refunds` returns the scoped coach's cases. `POST /api/coach/refunds/[caseId]/approve` reserves the approved amount and queues `issue_refund` on the original payment rail. A `202` response means the approval is recorded and provider processing is pending.
- In `src/lib/server/dynamo-refunds.ts`, `openRefundCase` accepts a stable review case ID and the original verified payment reference. `applyVerifiedRefund` consumes a reconciled provider result for that case. The fee summary shows net collected after verified success, and the paid fee stays closed.
- `createDynamoSubscriptionPayments` in `src/lib/server/subscription-payments.ts` is the verified-event entry point for the Cashfree adapter. Before submitting the provider charge, the adapter binds `providerSubscriptionId` and `merchantPaymentId` on the scoped cycle and uses the cycle's subscription collection reservation. Success credits the fee and creates one notification atomically. A retryable failure keeps the cycle processing. Once Cashfree confirms final failure and the linked parent's consent is present, the backend records an approval-gated recovery intent. The Relay integration rechecks eligibility before any outreach.

## Coach MCP tool

`GET /api/coach/summary?period=YYYY-MM` now uses `get_fee_summary` over an in-process MCP client and server. Its HTTP response keeps the same format. The tool reads via the `FeeStore` interface. Input is limited to `{period}` and output contains only expected, collected and outstanding paise and the paid fee count. The signed-in coach's record supplies the scope.

The Sarvam owner can use `withCoachFeeMcp(actor, store, callback)` in `src/lib/server/fee-mcp.ts` within the authenticated voice handler. Use `client.listTools()` for the function declaration, dispatch `get_fee_summary` using the validated tool arguments, and feed the successful `structuredContent` into Sarvam's next turn. A tool error means the totals are unavailable. The Lambda uses an in-memory MCP connection per request and requires no extra URL, credential or service for this tool. [Sarvam function calling](https://docs.sarvam.ai/api/token-factory/chat-completions#tool-calling-function-calling) · [MCP client transport](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/clients/connect.md)
