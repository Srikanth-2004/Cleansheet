# CS-09 · Cashfree Subscriptions lifecycle

**Owner** [Cashfree](../roles/03-cashfree.md) · **Start with** Sandbox credentials, test mandate and fixture events

- Confirm the revocable on-demand mandate and method-specific timing. Smoke-test hosted authorisation and provider status lookup. Build the enrol, charge, cancel and status adapters against the [provider seam](../docs/RELAY_CONTRACT.md#provider-and-agent-handoffs).
- Ingest signed subscription events and pass verified normalised state to Backend. Handle cancellation of the mandate and of a scheduled payment as distinct actions. Return paid, failed and pending outcomes with redacted references.
- **Handoff:** Give Backend confirmed ID mappings and event samples. Give Frontend the mandate URL and pending/active/cancelled scenarios. Finish with one provider-verified mandate and cancellation, plus an accurately labelled charge outcome or fixture.

Run provider smoke checks independently. Live app wiring requires [CS-02](CS-02-auth-and-fee-state.md) and [CS-12](CS-12-billing-state-and-refunds.md). Start in parallel with Relay access checks in [CS-10](CS-10-relay-and-voice.md).
