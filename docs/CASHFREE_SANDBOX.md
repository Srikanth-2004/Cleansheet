# Cashfree PG Sandbox handoff

## Create checkout

`POST /api/fees/{feeId}/checkout` requires the Cognito access token in `Authorization: Bearer ...` and an empty JSON body. The server checks parent access and reserves/reuses the order through `FeeStore.reserveCheckout`; clients cannot submit an amount.

Success response:

```json
{"ok":true,"data":{"orderId":"cs-...","paymentSessionId":"...","environment":"sandbox"}}
```

Frontend opens Cashfree Hosted Checkout using `@cashfreepayments/cashfree-js`:

```ts
const cashfree = await load({ mode: data.environment });
await cashfree?.checkout({ paymentSessionId: data.paymentSessionId, redirectTarget: '_self' });
```

## Verify payment

After Cashfree redirects to the configured `AppUrl/parent?payment=return&order_id=...`, call `POST /api/orders/{orderId}/verify` with the Cognito access token and an empty JSON body.

The backend rechecks the order and all payment attempts directly with Cashfree. It applies only a successful payment whose order id, amount, and currency match the stored checkout. It then calls the DynamoDB store's atomic, idempotent `applyVerifiedPayment`. Unresolved outcomes return HTTP 202 and `feeStatus: "processing"`; the parent can recheck.

## Configure Sandbox credentials

Create an AWS Secrets Manager secret containing JSON keys `clientId` and `clientSecret` using the Cashfree **PG Sandbox** credentials. Deploy with `CashfreePgSecretArn` set to that secret ARN and `AppUrl` set to the frontend base URL. This is distinct from the Secure ID secret. Secrets are injected only into Lambda and must not be added to `.env`, source, or frontend variables.

Cashfree Sandbox must have the frontend domain allow-listed. No production endpoint or payout transfer is enabled by this change.
