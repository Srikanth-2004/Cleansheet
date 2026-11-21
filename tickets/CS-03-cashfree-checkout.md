# CS-03 · Cashfree hosted checkout and verification

**Owner** [Cashfree](../roles/03-cashfree.md) · **Start dependency** Cashfree Sandbox credentials and test method

## Work

- Smoke-test Cashfree independently with a test order. Own the server adapter under `src/lib/providers/` and the checkout and verify routes in the [contract](../docs/CONTRACT.md). Use a fake store implementing the contract while CS-02 is in progress.
- Resolve the parent’s stored fee and reserve a stable order reference. Create or reuse the sandbox order and return the session for the hosted checkout SDK. Set a return URL for the parent view on the intended host.
- On return or recheck, resolve the order against the parent’s access and call Cashfree. Check order identity, amount, currency, and the successful payment before calling `applyVerifiedPayment`. Keep an unresolved provider state in `processing` and let the parent recheck.
- Extend the provider adapter for signed PG events, expiring recovery links, and PG refunds. Use the [Relay contract](../docs/RELAY_CONTRACT.md) and pass verified events to [CS-12](CS-12-billing-state-and-refunds.md). Create a recovery link only for the reserved eligible cycle. Give [CS-10](CS-10-relay-and-voice.md) the supported link-delivery handoff.

## Acceptance and handoff

- [ ] A hosted test checkout opens for the stored amount.
- [ ] Verification applies one successful payment. Retrying verification keeps totals unchanged. An unresolved or mismatched provider result cannot mark the fee paid.
- [ ] Share the observed state, masked provider ID, and return path with [CS-05](CS-05-coach-and-parent-ui.md) and [CS-08](CS-08-release-qa.md).

Provider work is independent of [CS-04](CS-04-raz-fee-preview.md). The deployed checkpoint uses [CS-01](CS-01-scaffold-and-deploy.md), [CS-02](CS-02-auth-and-fee-state.md), and the checkout control in CS-05. [Cashfree hosted checkout reference](https://www.cashfree.com/docs/payments/online/web/redirect)
