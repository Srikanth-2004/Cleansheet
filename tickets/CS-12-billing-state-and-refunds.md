# CS-12 · Billing state, notifications, and refunds

**Owner** [Backend](../roles/02-backend.md) · **Start with** The written event, action, and fixture contracts

- Build the DynamoDB cycle state and idempotent event projector. Record parent decisions, block new charges on cancel, and reserve one collection route per cycle. Keep raw provider status distinct from what the UI shows.
- Queue one coach notification after verified payment success, one coach-call intent after confirmed cancellation, and one eligible recovery action after rechecking status, retry state and consent. Reconcile uncertain or late outcomes before another side effect.
- Track refund cases, require scoped coach confirmation, validate the remaining refundable amount, and use the Cashfree adapter for the original rail. Update net collected only when a verified refund succeeds.
- **Handoff:** Publish the [route and event contracts](../docs/RELAY_CONTRACT.md), then demonstrate duplicate and out-of-order events, a cancel before charge, one coach notification, and refund reconciliation with fixtures. Give [CS-08](CS-08-release-qa.md) the real provider evidence as it becomes available.

Fixture work starts independently. Live adapters come from [CS-03](CS-03-cashfree-checkout.md) and [CS-09](CS-09-subscription-lifecycle.md). [CS-10](CS-10-relay-and-voice.md) consumes action intents and reports observed outcomes.
