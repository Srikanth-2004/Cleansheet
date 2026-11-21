# Relay and recurring fees · integration contract

This extends the [base contract](CONTRACT.md). It defines CleanSheet's interfaces for parallel work. Provider routes and response types follow the account's verified documentation.

## App routes and ownership

| Route | Auth and request | Response data | Implementation owner |
|---|---|---|---|
| `GET /api/parent/billing` | Linked parent | `{subscription, cycle, contactStatus, outreachConsent}` | Backend |
| `POST /api/parent/contact/start` | Parent, `{phone, consentVersion}` | `{challengeId, maskedPhone, expiresAt}` | Backend / Secure ID |
| `POST /api/parent/contact/verify` | Same parent, `{challengeId, otp}` | `{contactStatus, maskedPhone}` | Backend / Secure ID |
| `POST /api/parent/outreach-consent` | Parent, `{granted, consentVersion}` | `{outreachConsent}` | Backend |
| `POST /api/parent/subscription/enrol` | Linked parent; server resolves the configured plan | `{subscriptionId, mandateUrl, status}` | Cashfree |
| `POST /api/parent/billing/cycles/[id]/decision` | Linked parent, `{decision: 'keep' or 'cancel_subscription'}` | `{cycleStatus, subscriptionStatus}` | Backend |
| `GET /api/coach/billing/notifications` | Coach | `{notifications:[{id, kind, occurredAt, subjectLabel, amountPaise?}]}` | Backend |
| `POST /api/coach/refunds/[caseId]/approve` | Scoped coach, `{amountPaise}` | `{refundId, status}` | Backend with Cashfree adapter |
| `POST /api/webhooks/cashfree/pg` and `/api/webhooks/cashfree/subscriptions` | Authenticate raw provider payloads, deduplicate by provider and event | Provider acknowledgement | Cashfree parses, Backend projects |

`subscription` is `{id,status,nextDueAt}` or `null`. `cycle` is `{id,period,amountPaise,dueAt,status,recoveryUrl}` or `null`. The link is nullable and is available only to the scoped parent while eligible. `outreachConsent` is `granted` or `withheld`. `contactStatus` is `unverified`, `pending`, `verified`, or `blocked`. The signed-in parent’s verified contact and permission are required before dispatching parent outreach for the pilot.

Use app subscription states `authorising`, `active`, `cancel_pending`, `cancelled`, and `needs_review`. Use cycle states `awaiting_decision`, `decision_recorded`, `charge_scheduled`, `processing`, `paid`, `failed`, `recovery_available`, `closed`, and `needs_review`. Where supported, keep provider webhooks and scheduled jobs separate from browser routes. Browser routes retain the Cognito access-token authentication and response envelope.

## DynamoDB handoff

All keys live in the selected demo partition. The Cashfree subscription integration should link a verified mandate under **SUBSCRIPTION#playerId** with fields **id**, **parentUid**, **status**, **nextDueAt**, and **currentCycleId**. The active **CYCLE#cycleId** stores **id**, **parentUid**, **playerId**, **period**, **amountPaise**, **dueAt**, **cutoffAt**, **status** and an optional approved **recoveryUrl**. Use ISO UTC timestamps and a route-safe cycle ID. Contact verification projects the result to **CONTACT#parentUid**. The consent route stores the separate outreach choice.

Keep creates one **schedule_charge** intent and reserves the subscription collection path. The cycle remains in **decision_recorded** until a provider charge is scheduled. Cancel changes the mandate to **cancel_pending** and creates one **cancel_subscription** intent. The provider adapter or worker must claim the intent, read current state again, and reconcile the provider result. Verified cancellation is what authorises the coach call. Neither parent route calls a provider directly.

## Provider and agent handoffs

| Producer | Consumer | Shared shape |
|---|---|---|
| Cashfree adapters | Backend projector | Verified event with `{source, eventKey, kind, providerObjectId, relatedIds, amountPaise?, currency?, observedAt, providerStatus}`. Backend looks up trusted mappings. |
| Backend | Cashfree adapters | Stored scope, approved amounts, stable client references, and verified current state for enrol, charge, cancel, recovery link and refund operations. Use one collection reservation per cycle. |
| Backend | Relay / Sarvam | Approved action `{actionId, kind, merchantRef, cycleRef?, targetRef, language, runAfter}`. `kind` is `precharge_parent_call`, `recovery_parent_call_and_link` or `cancellation_coach_call`. Resolve delivery data server-side when dispatching. Refund reviews can create a case suggestion through the documented merchant workflow. |
| Relay / Sarvam | Backend | `{actionId, providerActionId?, outcome, observedAt}` where outcome is `queued`, `delivered`, `failed`, `unknown`, or `blocked`. Implement an incoming route only when the vendor authentication, schema, and correlation are verified. A dashboard result may be logged with an auditable reference. |
| Backend / optional MCP | Sarvam | `get_fee_summary(period)` accepts the month. Bind the verified coach in server context and return only authorised totals. |

## Fixture scenarios

- **Success:** `cycle-u12-2026-11` is ₹1,500. Parent confirms keep, the active mandate is checked, and verified provider success changes the cycle to `paid`. A duplicated or delayed event leaves one coach notification and one ledger credit.
- **Cancellation:** Parent confirms cancel. Charge creation is blocked immediately. The verified cancellation updates the subscription and queues exactly one coach call. Pending payment is handled separately. An unanswered reminder creates no debit or assumed consent.
- **Recovery:** A terminal verified failure with no scheduled retry can open one recovery case and one active link. A duplicate failure or later success cannot trigger a second outreach. Cancellation stops new renewal collection and routes any already owed cycle for review before new outreach.
- **Refund:** An approved ₹500 refund against a verified ₹1,500 payment leaves the original credit intact and reduces net collected to ₹1,000 after provider confirmation. A pending or failed refund leaves net collected unchanged.

Fixture events and simulated scheduling stay visibly labelled. Only provider-observed payment, call and refund outcomes appear as verified in the demo.
