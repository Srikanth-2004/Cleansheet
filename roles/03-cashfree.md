# Person 3 · Cashfree integration

**Primary ticket** [CS-03 · Cashfree checkout](../tickets/CS-03-cashfree-checkout.md)

**Release duty** Provide payment evidence to [CS-08 · Release QA](../tickets/CS-08-release-qa.md).

## Start independently

1. Smoke-test Cashfree Sandbox order creation, hosted checkout, and a trusted provider status lookup using a test order. Use a fake implementation of the [payment store seam](../docs/CONTRACT.md#server-seam) while Backend builds Firebase.
2. Own the Cashfree adapter and `POST /api/fees/[id]/checkout` and `POST /api/orders/[id]/verify`. Resolve the stored fee, reuse the reserved order on repeat attempts, and return the checkout session to Frontend.
3. Verify a successful payment against the authorised sandbox order, stored amount, and currency before applying it. Keep unresolved outcomes in the checking flow. Coordinate the hosted return path and recheck behavior with Frontend.

## Handoffs

| With | What to exchange |
|---|---|
| Backend | Auth/store helpers and smoke fee in. Observed provider state, masked order reference, amount, and duplicate-verification result out. |
| Frontend | Checkout response, return path, and the verification/recheck behavior. |
| Sarvam | No direct runtime handoff. Both workstreams meet in the deployed demo using Backend's persisted fee and Frontend's UI. |

**Done when** one deployed sandbox checkout is server-verified for the expected amount and repeating verification leaves totals unchanged. Aim for **1:30 PM IST** with Backend and Frontend. Raise access or checkout blockers early so the payment flow remains the priority.
