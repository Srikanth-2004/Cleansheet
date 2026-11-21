# Person 2 · Backend

**Primary tickets** [CS-01 · Scaffold and deploy](../tickets/CS-01-scaffold-and-deploy.md), then [CS-02 · Firebase and fee state](../tickets/CS-02-firebase-and-fee-state.md)

**Release duty** [CS-08 · Integration and release QA](../tickets/CS-08-release-qa.md)

## Start independently

1. Publish the smallest buildable Next.js scaffold and deploy it. Share the merge-base commit and host early so other builders can integrate without waiting for the data layer.
2. Own root config, deployment, `src/contracts/`, Firebase Admin, the server store and seed, and identity/fee/summary routes. Follow the [contract](../docs/CONTRACT.md). Wire sign-in and access for the coach and linked parent, and seed distinct smoke and filming scenarios.
3. Implement the auth helper, checkout store seam, and atomic fee and payment writes. Keep the provider requests in the Cashfree and Sarvam owners' modules.

## Handoffs

| To | What to hand off |
|---|---|
| Frontend | Scaffold, identity/fee/summary routes, seeded period, and test account access through the team's approved channel |
| Cashfree | `getActor`, `reserveCheckout`, `getCheckout`, and `applyVerifiedPayment`, plus smoke fee and host details |
| Sarvam | `getActor`, coach access rules, and shared preview types |
| Video and submission | Verified deploy URL and commit, observed checks, and any fallback used |

**Done when** the coach and parent can sign in, access checks hold, and duplicate confirmation and payment verification change state once. Coordinate the **1:30 PM IST** payment checkpoint with Cashfree and sign off on the final deployed demo after integration.
