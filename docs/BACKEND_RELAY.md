# CleanSheet backend plan · Relay and recurring fees

This is the active integration plan for monthly fees. The [existing HTTP contract](CONTRACT.md) still covers sign-in, fee preview and confirmation, the coach summary, and the one-time checkout. This plan adds the subscription lifecycle, Relay workflows, Secure ID, and refund reconciliation. Start with the [ticket board](../tickets/README.md).

## Product responsibilities

| Component | Responsibility |
|---|---|
| CleanSheet backend and Firestore | Authorise the coach or linked adult parent, link Cashfree references to one fee cycle, record decisions and provider state, and make financial changes and notifications idempotent. |
| Cashfree Relay | Review Cashfree payment records, run approved pre-charge and recovery outreach where enabled, resend the eligible retry link, call the coach on a confirmed cancellation where supported, and triage refund cases. |
| Cashfree Subscriptions | Authorise a parent mandate, schedule or execute a due payment, cancel future charges, and expose verified mandate, payment, and subscription refund outcomes. |
| Cashfree Payment Gateway | Run one-time hosted checkout and the eligible recovery link, verify payment status, and create and track refunds for PG payments. |
| Cashfree Secure ID | Run a consent-based Mobile 360 OTP check for the adult parent's contact number where the product supports the test setup. Record verification status and reference. Outreach consent and mandate authorisation are separate. |
| Sarvam | Power the existing Hindi or Kannada Raz interaction and the Relay voice experience where the merchant workspace supports Sarvam. |

## Merchant access checks at kickoff

Cashfree and Sarvam owners work these checks in parallel. Record `verified`, `blocked`, or `simulated` per capability and attach redacted evidence. Use the event credentials and consenting adult test contacts.

1. **Relay:** Check Payment Recovery and Subscription Dunning on the event account. Ask Cashfree for supported triggers and outcomes for a custom pre-charge decision, coach-directed outbound call, recovery-link delivery, and refund review. Confirm what can be read from Cashfree-managed records, how an app can correlate action IDs, whether verified callbacks or an authenticated status read exist, and what approval applies to calls and money movement. Capture the official account-specific integration instructions before adding code. When Relay only supports a dashboard workflow, run the approved demonstration there and log the observed status with its reference.
2. **Subscriptions and PG:** Verify sandbox mandate creation and host authorisation, the applicable charge mode and notice window, cancellation, both signed webhook streams, hosted PG checkout, and one supported provider refund lookup.
3. **Secure ID:** Check Mobile 360 consent, test OTP delivery and verification, and the minimum allowed result fields. A blocked provider is shown as blocked. Fixture mode can support parallel UI and policy work.

## Lifecycle and authority

| Trigger | Action and record of truth | Parent or coach experience |
|---|---|---|
| Enrolment | Firebase identifies the signed-in adult linked to the player. Capture Secure ID consent and verify the nominated test phone. Collect separate permission for outreach. The parent authorises the revocable mandate on Cashfree's hosted flow. Project `active` only after verified provider status. | Parent sees verification and mandate status. |
| Monthly fee is coming due | Create a due cycle from the stored monthly plan before submitting a debit. Queue the approved Relay voice workflow to explain amount and due date. Bind the action to the cycle and direct the parent to an authenticated decision screen. | Parent chooses **Keep this cycle** or **Cancel subscription**. A failed or unanswered call leaves the cycle awaiting a decision and no debit is submitted for the pilot. |
| Keep confirmed | Recheck that the mandate is active and no cancellation or open collection is pending. Release one on-demand charge for the cycle using Cashfree's supported notice and scheduling flow. For controlled UPI charging, send the pre-debit notice and wait at least 24 hours before execution as documented. | Parent sees scheduled or processing and retains access to cancellation. |
| Cancel requested | Immediately block new charge submission for the mandate. Cancel the mandate through Cashfree and handle an already-scheduled charge separately using the applicable cancellation endpoint and cutoff. Reconcile any in-flight result. | Parent sees cancellation pending. After provider-confirmed mandate cancellation, queue one coach voice call via the approved Relay/Sarvam route. If calling is unavailable, show the cancellation and flag the call as unavailable. |
| Verified payment succeeds | Apply verified `INR` amount to the corresponding cycle exactly once. Close recovery actions and expire any still-open recovery link where supported. | Coach receives one in-app payment-completed notification with a safe parent/player label and amount. |
| Eligible payment failure | Check latest status and any provider retry schedule first. Once the attempt is terminal and recovery is approved, Relay calls the parent and re-shares one active, expiring Cashfree payment link where supported. Use a distinct link or order mapped to the same cycle. Avoid offering PG recovery while a subscription debit or retry can still settle. | Parent gets the verified retry path. Coach sees failed or recovery pending until provider success. |
| Refund request or outcome | Relay reviews the relevant payment and opens a case. A coach confirms the scope and amount in CleanSheet before the backend requests an eligible refund on the original rail. Verify the refund with Cashfree and record it separately from the original payment. | Coach sees requested, processing, refunded, or failed. Keep original payment history and update net collected only on confirmed refund. |

The pilot uses a revocable **on-demand** mandate so the app can wait for an authenticated choice before even submitting a charge. A confirmation expires at the cycle cutoff. Secure ID proves contact verification within its supported scope. Firebase and the server-owned link still control account access. A voice classification can suggest an intent. An authenticated parent confirmation is needed to keep or cancel billing, and a coach confirmation is needed to issue a refund.

## Backend boundaries and contracts

- Use product-specific provider adapters and webhook routes for Subscriptions and PG. Validate the raw webhook signature with the configured secret, resolve the stored merchant and object IDs, and reconcile conflicting, stale, or ambiguous events using the provider API. Keep all provider credentials and contact details server-side.
- Store `subscription`, `billingCycle`, `paymentAttempt`, `refundCase`, `providerEvent`, and `outreachAction` records. A cycle is keyed by academy, player, and month. Keep provider status separately from app status. The parent and coach see role-scoped view models.
- Atomically project the event and create an outreach or notification intent. Claim each outbound action by a deterministic ID such as `cycleId:recovery_call` or `subscriptionId:cancelled_coach_call`. Save the provider action ID and observed delivery state. After an uncertain send, reconcile before retrying. Recheck consent and terminal payment/mandate state before dispatch. Store only the contact verification result and reference, purpose-specific consent, and audit metadata needed by the workflow.
- Reserve one active collection path per cycle. Use stable IDs and supported provider idempotency keys for retries. Late success on two paths is a reconciliation case and does not credit the fee twice. A refund request is bounded by the verified payment minus pending and completed refunds. Use the original provider rail and one refund reference per approved request. Refunds do not reopen the cycle automatically.
- CleanSheet can expose read-only, actor-scoped MCP tools to Raz for fee and payment summaries. Backend owns the checked records. The Sarvam/Relay owner maps only declared tools and supported workflows. MCP and Relay contexts receive the minimum data needed for the action, with no raw database access, OTPs, credentials, or broad account lookups.

See [Relay integration contract](RELAY_CONTRACT.md) for parallel implementation seams and fixture scenarios.

## Build and demonstrate in order

1. **First gate:** Deploy the existing hosted PG happy path and verify one paid fee. Show the coach's success notification exactly once.
2. **Second gate:** Reuse the same ledger for a real sandbox mandate, one parent choice, and a verified cancellation. Show the coach call if Relay and the route work on the event account. Secure ID tests can run in parallel.
3. **Third gate:** Show an eligible recovery call and link delivery and reconcile a refund case. Only say a provider action happened when the evidence supports it.

The full lifecycle is a multi-stage integration. Use one real sandbox PG payment plus a separately labelled simulation or pre-staged provider sample for a subscription cycle that cannot settle inside the sprint. The plan follows the provider's actual debit timing. See [release QA](../tickets/CS-08-release-qa.md) for demo evidence and checks.

## Provider references

- [Cashfree Relay overview](https://www.cashfree.com/relay/) and [Relay payment recovery, dunning and approvals](https://www.cashfree.com/blog/ai-superagent-that-runs-smb-payment-operations/)
- [Subscription charging and notice timing](https://www.cashfree.com/docs/payments/subscription/charge), [cancel and refund lifecycle](https://www.cashfree.com/docs/payments/subscription/manage), and [subscription webhooks](https://www.cashfree.com/docs/payments/subscription/webhooks)
- [Payment Gateway](https://www.cashfree.com/docs/payments/overview), [Payment Links](https://www.cashfree.com/payment-links/), and [webhook signature verification](https://www.cashfree.com/docs/payments/online/webhooks/signature-verification)
- [Secure ID Mobile 360 and consent](https://www.cashfree.com/docs/secure-id/1-click-onboarding/mobile360/mobile-360)
