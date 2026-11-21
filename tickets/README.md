# CleanSheet ticket board

Read the [sprint spec](../docs/SPEC.md) and [shared contract](../docs/CONTRACT.md). The [four role files](../README.md#four-person-split) describe the default assignments. Record one named owner per ticket here or in the team’s shared tracker. Claim one primary engineering ticket at a time.

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

**Kickoff.** Frontend takes CS-05, Backend takes CS-01, Cashfree takes CS-03, and Sarvam takes CS-04. Backend moves to CS-02 as soon as the scaffold is published. Work against fixtures and provider smoke checks until the live dependencies land. Prepare lightweight capture and pitch assets when time permits and finish them after the feature freeze.

**Status.** `READY → CLAIMED → MERGEABLE → VERIFIED`. Mark `MERGEABLE` when isolated checks pass or a non-code asset is ready for review. Mark `VERIFIED` when the ticket’s deployed or deliverable checks pass. Record access blockers against the affected ticket and use the fixture or start an unowned task when possible.

**Handoff.** Post `CS-## | owner | status | branch/PR/asset | check and observed result | blocker or next consumer`. Each owner updates their ticket. Backend coordinates release evidence, and the relevant builder owns any fix raised by QA.
