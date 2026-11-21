# CS-11 · Secure ID adult contact verification

**Owner** [Backend](../roles/02-backend.md) · **Start with** Secure ID test credentials and a verified Mobile 360 OTP test path

- Confirm consent, OTP delivery, and minimum response categories with Cashfree. Bind each challenge to the signed-in adult and nominated number, expire it, and store only the resulting status, masked view, reference, and verification timestamp. Keep OTPs and full provider responses out of logs and agent context.
- Enforce separate revocable outreach consent. Work against the [contact contract](../docs/RELAY_CONTRACT.md#app-routes-and-ownership) and give Frontend fixtures for verification required, verified, and blocked. Keep provider credentials on the server.
- **Handoff:** Show one observed test result or record the provider blocker. Demonstrate that an expired or wrong-account challenge and a requested outreach without consent produce zero authorised actions.

Provider checks can start before [CS-02](CS-02-auth-and-fee-state.md) lands. Scoped UI and dispatch enforcement connect to [CS-05](CS-05-coach-and-parent-ui.md) and [CS-10](CS-10-relay-and-voice.md).
