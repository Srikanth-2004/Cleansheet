# CS-10 · Cashfree Relay and Sarvam outreach

**Owner** [Sarvam / Relay](../roles/04-sarvam.md) · **Start with** Relay merchant access and consenting adult test contacts

- Verify available Payment Recovery and Subscription Dunning workflows, supported triggers and callbacks, and Sarvam as the permitted voice provider. Ask for the account-specific workflow setup for pre-charge outreach, recovery link delivery, coach cancellation calls, and refund review.
- Draft short calls for the parent reminder, payment recovery, and coach cancellation. Route the parent's keep or cancel choice to the authenticated billing screen. Use the [approved action contract](../docs/RELAY_CONTRACT.md#provider-and-agent-handoffs) and capture only verified outcomes.
- **Handoff:** Record a provider action reference and delivery evidence for each working flow. Label dashboard-run evidence, unavailable features, and simulated callbacks individually. Give Frontend the expected interaction and Backend the verified integration seam.

Access checks, scripts, and fixture outcome tests start independently. Live payment recovery needs eligible provider state and an expiring link from [CS-03](CS-03-cashfree-checkout.md). Cycle and cancellation actions need [CS-09](CS-09-subscription-lifecycle.md), [CS-11](CS-11-secure-id-contact.md), and [CS-12](CS-12-billing-state-and-refunds.md). [CS-04](CS-04-raz-fee-preview.md) covers the coach's interactive Raz flow.
