# CS-05 · Coach and parent UI

**Owner** `@jv-013` ([Frontend](../roles/01-frontend.md)) · **Status** `MERGEABLE` (branch `cs-05-coach-and-parent-ui`) · **Start dependency** Written contract and fixture values

## Work

- Own the UI routes and components, Cognito PKCE client, audio recorder, and local fixture mode. Start from the [fixture examples](../docs/CONTRACT.md#fixture-handoff) and use the [sprint visuals](../docs/SPEC.md#demo-data-and-visuals).
- Build the sign-in entry, coach dashboard, and parent fee screen. Coach flow is record/type, preview, confirm, and refresh collections. Parent flow is view linked fee, pay on hosted checkout, return to checking, and verify or recheck.
- Match real and fixture response shapes. Turn on the Cashfree control as soon as the sandbox session route is available so release QA can run the smoke payment before the voice work lands.
- Use the [billing fixtures](../docs/RELAY_CONTRACT.md#fixture-scenarios) to add parent verification, mandate entry and keep/cancel controls. Show coach payment notifications, cancellation and refund statuses, and a scoped refund approval control. Preserve pending states and identify simulated outcomes in the demo.

## Acceptance and handoff

- [x] Both roles can be exercised locally using labelled fixtures.
- [ ] On the deployed app, both test accounts reach the correct view. Coach confirmation creates the fee, the parent reaches Cashfree, and the settled dashboard refresh reflects server verification.
- [ ] The demo deployment uses real routes. Give [CS-06](CS-06-demo-video.md) and [CS-08](CS-08-release-qa.md) the capture path, UI URLs, and any known blocker.

**Handoff note:** `CS-05 | @jv-013 | MERGEABLE | branch: cs-05-coach-and-parent-ui | web:typecheck, web:build & live Chrome browser check passed | Blocker for VERIFIED: deployed API & Cashfree checkout/verify routes`

Merge after [CS-01](CS-01-scaffold-and-deploy.md). Live verification depends on [CS-02](CS-02-auth-and-fee-state.md), [CS-03](CS-03-cashfree-checkout.md), and [CS-04](CS-04-raz-fee-preview.md). The seeded smoke fee supports testing checkout first.
