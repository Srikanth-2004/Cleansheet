# CleanSheet ticket board

Start with the [Relay backend plan](../docs/BACKEND_RELAY.md), [Relay integration contract](../docs/RELAY_CONTRACT.md), and the [four role files](../README.md#four-person-split). The [base contract](../docs/CONTRACT.md) covers the first one-time checkout. Record one named owner per ticket here or in the team's shared tracker.

| Ticket | Suggested owner | Start independently with | Needed for live completion | Initial status |
|---|---|---|---|---|
| [CS-01 · Scaffold and deploy](CS-01-scaffold-and-deploy.md) | Backend | Minimal permitted scaffold | Repo and Vercel access | READY |
| [CS-02 · Firebase and fee state](CS-02-firebase-and-fee-state.md) | Backend after CS-01 | Firebase project, test identities, and written contract | CS-01 merge base and host | READY |
| [CS-03 · Cashfree checkout](CS-03-cashfree-checkout.md) | Cashfree | Cashfree Sandbox and fake fee store | CS-01 host, CS-02 store, CS-05 checkout control | READY |
| [CS-04 · Raz fee preview](CS-04-raz-fee-preview.md) | Sarvam | Sarvam key and sample clip | CS-01 host, CS-02 auth, CS-05 recording or typed input | READY |
| [CS-05 · Coach and parent UI](CS-05-coach-and-parent-ui.md) | Frontend | Contract-shaped fixtures | CS-01 shell and real routes from CS-02, CS-03, and CS-04 | READY |
| [CS-06 · Demo video](CS-06-demo-video.md) | Frontend | Script, captions, edit timeline, test export | CS-08 verified build | READY |
| [CS-07 · Pitch and submission](CS-07-pitch-and-submission.md) | Sarvam | Briefing, checklist, deck skeleton | CS-06 video and CS-08 release | READY |
| [CS-08 · Release QA](CS-08-release-qa.md) | Backend, with Cashfree payment evidence | QA checklist and evidence template | CS-01 through CS-05 on one deploy | READY |
| [CS-09 · Subscriptions lifecycle](CS-09-subscription-lifecycle.md) | Cashfree | Test mandate, provider status and event samples | CS-02 identity and CS-12 projection | READY |
| [CS-10 · Relay and voice](CS-10-relay-and-voice.md) | Sarvam / Relay | Access checks, call scripts and fixture outcomes | CS-03 recovery path, CS-09 status, CS-11 consent and CS-12 actions | READY |
| [CS-11 · Secure ID](CS-11-secure-id-contact.md) | Backend | Consent, OTP test path and contact fixtures | CS-02 auth and CS-05 contact view | READY |
| [CS-12 · Billing state and refunds](CS-12-billing-state-and-refunds.md) | Backend, with Cashfree refund adapter | Normalised event and action fixtures | CS-03/09 provider adapters and CS-10 outreach result evidence | READY |

**Kickoff.** Frontend starts CS-05 with billing fixtures, Backend publishes CS-01 and CS-02, Cashfree runs the PG and subscription smoke checks in CS-03 and CS-09, and Sarvam checks Relay access in CS-10. Backend starts CS-12 against fixture events and uses CS-11 for contact testing. Polish Raz in CS-04 once core flows are connected. Integrate in the order set by the [backend plan](../docs/BACKEND_RELAY.md#build-and-demonstrate-in-order).

**Status.** `READY → CLAIMED → MERGEABLE → VERIFIED`. Mark `MERGEABLE` when isolated checks pass or a non-code asset is ready for review. Mark `VERIFIED` when the ticket’s deployed or deliverable checks pass. Record access blockers against the affected ticket and use the fixture or start an unowned task when possible.

**Handoff.** Post `CS-## | owner | status | branch/PR/asset | check and observed result | blocker or next consumer`. Each owner updates their ticket. Backend coordinates release evidence, and the relevant builder owns any fix raised by QA.
