# Shared integration contract

For recurring charges, verification, and Relay actions, also use the [Relay integration contract](RELAY_CONTRACT.md).

This is the implementation seam between the UI, Firebase store, Raz, and Cashfree. Builders can work from these shapes before adjacent code lands. [CS-02](../tickets/CS-02-firebase-and-fee-state.md) materialises the shared types and validators in `src/contracts/`.

## Common values

- Every listed route is protected. Send `Authorization: Bearer <Firebase ID token>`. The server verifies the token and resolves access from seeded records.
- JSON success is `{ok:true,data:…}`. JSON failure is `{ok:false,error:{code,message}}` with an appropriate HTTP status. Use `401` for missing or invalid credentials, `403` or `404` for inaccessible records, `400` for invalid input, and `409` for a conflicting fee amount.
- `role` is `coach` or `parent`. `period` is `YYYY-MM`. `locale` is `hi-IN` or `kn-IN` for the chosen demo language. Amounts are positive safe integers in paise for fees and `currency` is `INR`. `status` and `feeStatus` are `unpaid`, `processing`, or `paid`.
- Resolve academy, squad, player, and payable amount on the server. A fixture can provide these records locally; a deployed evidence run uses Firestore and provider responses.

## HTTP routes

| Route | Access and input | Success `data` | Owner |
|---|---|---|---|
| `GET /api/me` | Either seeded role | `{role, academyName, teamName}` | CS-02 |
| `GET /api/coach/summary?period=YYYY-MM` | Coach | `{expectedPaise, collectedPaise, outstandingPaise, paidFeeCount}` | CS-02 |
| `GET /api/parent/fees?period=YYYY-MM` | Parent | `{fees:[{id, playerName, period, amountPaise, currency, status}]}` | CS-02 |
| `POST /api/raz/fee-preview` | Coach. Multipart `{audio, locale, period}` or JSON `{text, locale, period}` | `{transcript, preview:{period, amountPaise}}` | CS-04 |
| `POST /api/coach/fees` | Coach. Explicit confirmation `{period, amountPaise}` | `{feeId, status}` | CS-02 |
| `POST /api/fees/[id]/checkout` | Linked parent. Empty body | `{orderId, paymentSessionId, environment:'sandbox'}` | CS-03 |
| `POST /api/orders/[id]/verify` | Linked parent. Empty body | `{feeId, feeStatus}` | CS-03 |

The preview creates zero fee records. Ambiguous or invalid commands return a retry message in the error envelope. Confirmation revalidates the inputs and writes one fee per scoped player and period. An identical confirmation returns the existing fee. An amount change for the same player and period returns a conflict.

## Server seam

| Function from CS-02 | Used by | Behavior |
|---|---|---|
| `getActor(request)` | CS-03, CS-04 | Verify Firebase ID token and resolve `{uid, role}`. |
| `reserveCheckout(uid, feeId)` | CS-03 | Check parent access and reserve or load a stable checkout order for an unpaid fee. Return `{feeId, orderId, amountPaise, currency, customer:{id, name, email, phone}}` from stored data. |
| `getCheckout(uid, orderId)` | CS-03 | Return the authorised stored checkout record by order ID. |
| `applyVerifiedPayment(orderId, providerPaymentId)` | CS-03 | Atomically apply the trusted payment once and return `{feeId, feeStatus}`. Repeated application keeps totals unchanged. |

CS-03 checks the expected sandbox order, amount, currency, and successful provider payment before calling `applyVerifiedPayment`. The browser return and a provider submission response may trigger verification. An unresolved provider result stays `processing`. Provider calls run outside Firestore transaction callbacks.

## Fixture handoff

The mock UI and adapter fixtures can use `First Touch Academy`, `U12`, `Demo Player`, period `2026-11`, a fee of `150000` paise, and IDs such as `fee-fixture-01` and `order-fixture-01`. After confirmation, the unpaid summary is `{expectedPaise:150000, collectedPaise:0, outstandingPaise:150000, paidFeeCount:0}`. After provider verification, the paid summary is `{expectedPaise:150000, collectedPaise:150000, outstandingPaise:0, paidFeeCount:1}`. Fixture order/session IDs stay local. The smoke test and final recording use distinct server-generated references.
