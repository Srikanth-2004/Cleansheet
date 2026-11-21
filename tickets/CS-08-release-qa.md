# CS-08 · Integration and release QA

**Owner** [Backend](../roles/02-backend.md) coordinates, with payment evidence from [Cashfree](../roles/03-cashfree.md) · **Start dependency** Written contract and test plan

## Work

- Use the checklist below. By **1:30 PM IST**, aim to run hosted checkout against the seeded unpaid smoke fee and verify it on the server. Keep payment on the critical path if this slips.
- By **2:40 PM IST**, aim to join Raz, confirmation, checkout, and the dashboard in a fresh scenario. At the **3:00 PM IST** feature freeze, prioritise blockers and record the final release result.
- Log the deployed URL and commit, test scenario, masked order reference, observed provider state, and before-and-after totals. Assign any fixes to the owner of the affected ticket. If recording is blocked, run the typed Sarvam path and log the fallback.

## Acceptance and handoff

- [ ] A parent cannot access an out-of-scope fee or order.
- [ ] Repeated confirmation produces one fee. Repeated payment verification changes totals once.
- [ ] On the same deployment, Raz returns the fee preview, the coach confirms, the parent pays through Cashfree Sandbox, and the dashboard matches the provider-verified ₹1,500 payment.
- [ ] [CS-06](CS-06-demo-video.md) and [CS-07](CS-07-pitch-and-submission.md) receive the verified deployment, capture sequence, and any limitations.

## Relay and subscriptions acceptance

- [ ] Record evidence per product. Cashfree PG success produces one coach notification. Verify Subscriptions mandate and cancellation independently of the pilot's charge timing.
- [ ] A parent cancellation blocks new charges. Provider-confirmed cancellation queues one coach call. An unanswered pre-charge call leaves the cycle waiting. Mark any outbound call that the event account cannot verify as unavailable or simulated.
- [ ] A terminal failure without an active retry can recover via one link. A late success or duplicate event cannot credit or contact twice. A refund changes net collected only on verified provider success.
- [ ] Secure ID contact status and outreach consent are shown separately. Use approved test contacts and preserve the distinction between live provider evidence and fixture events.

Smoke checkout needs [CS-01](CS-01-scaffold-and-deploy.md), [CS-02](CS-02-firebase-and-fee-state.md), [CS-03](CS-03-cashfree-checkout.md), and the checkout control in [CS-05](CS-05-coach-and-parent-ui.md). The full run also needs [CS-04](CS-04-raz-fee-preview.md).
