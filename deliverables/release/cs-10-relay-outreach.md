# CS-10 · Cashfree Relay & Sarvam Outreach Scripts

**Owner:** `@jv-013` ([Sarvam / Relay](../../roles/04-sarvam.md))  
**Status:** `MERGEABLE` (Action contract, consent gate, and bilingual call scripts wired)

## Approved Action Contract

CleanSheet dispatches Relay / Sarvam outreach only after server-side checks confirm:
1. Validated actor identity (`getActor` / `requireServerActor`).
2. Adult contact verification status `verified` (`CS-11`).
3. Explicit parent `outreachConsent === 'granted'` for parent-facing calls.
4. Deterministic idempotency key (`cycleId:recovery_call`, `subscriptionId:cancelled_coach_call`).

```json
{
  "actionId": "cycle-u12-2026-11:recovery_call",
  "kind": "recovery_parent_call_and_link",
  "merchantRef": "first-touch-u12",
  "cycleRef": "cycle-u12-2026-11",
  "targetRef": "contact-verified-parent-u12",
  "language": "hi-IN",
  "runAfter": "2026-11-21T08:00:00Z"
}
```

## Bilingual Call Scripts (`hi-IN` / `kn-IN`)

1. **`precharge_parent_call`** — Pre-charge decision reminder directing the parent to `/parent` to choose `Keep` or `Cancel Subscription` (no assumed consent, no voice-triggered debit).
2. **`recovery_parent_call_and_link`** — Triggered strictly after terminal subscription debit failure when no retry is pending; delivers the single active `recoveryUrl`.
3. **`cancellation_coach_call`** — Triggered once after verified `SUBSCRIPTION_STATUS_CHANGED` (`CANCELLED` / `CUSTOMER_CANCELLED`) updates the mandate and blocks future charges.
