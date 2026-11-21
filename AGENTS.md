# CleanSheet repository instructions

## Start work

- Read [the sprint spec](docs/SPEC.md), [the shared contract](docs/CONTRACT.md), and your [role file](README.md#four-person-split). Open the assigned file in [the ticket board](tickets/README.md). The ticket and contract define the event-day implementation.
- For subscription, Relay, recovery, or refund work, also use the [backend plan](docs/BACKEND_RELAY.md) and [Relay contract](docs/RELAY_CONTRACT.md). Record merchant access checks before wiring provider-specific Relay triggers or callbacks.
- Check the current branch, claimed owner, and latest handoff. Work within the assigned ticket’s paths. Use one branch per implementation ticket. Discuss a shared contract change with the contract owner and affected consumers before changing both sides.
- Start with the ticket’s fixture or provider smoke path if another builder’s work is pending. Match the contract exactly so fixtures can be replaced without UI or API rewrites.

## Implementation and evidence

- Resolve identity and data access on the server from the Cognito access token. Keep provider credentials server-side. Use invented data and Cashfree Sandbox. Keep local fixtures visibly labelled and disabled on the deployed evidence build.
- Store money in integer paise. Raz prepares a proposal; only explicit coach confirmation creates a fee. Checkout uses the stored fee amount. Apply a verified provider payment atomically and once.
- Run the ticket’s acceptance checks. Report observed evidence using `ticket | owner | status | branch/PR/asset | check result | blocker or next consumer`. Use `MERGEABLE` for isolated checks and `VERIFIED` for the relevant deployed, capture, or submission evidence.
- At the 3 PM IST feature freeze, focus on defects in the demo path, recording, and submission. Use the [release QA ticket](tickets/CS-08-release-qa.md) for the end-to-end checks.
