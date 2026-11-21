# CleanSheet sprint specification

The [Relay backend plan](BACKEND_RELAY.md) sets the current scope for subscriptions, recovery, Secure ID and refunds. The original one-time checkout flow below is the first integration checkpoint and provides the base app screens and sign-in flow.

**Event** Cashfree × Sarvam AI Buildathon, Bengaluru, Saturday 21 November 2026. Times in this pack are IST. The sprint runs from 12:30 to 4:00 PM with lunch from 1:30 to 2:15 PM. The opening briefing and organiser updates govern track and submission rules. [Published agenda and ground rules](https://luma.com/azuhrzuj)

## Demo outcome

1. The coach signs in and records a short fee command in one rehearsed language, Hindi or Kannada. Use typed input through the same Sarvam interpretation path if recording fails.
2. Raz proposes a fee for the seeded player on the U12 squad. The coach sees the amount and period and explicitly confirms.
3. A pre-linked test parent signs in, sees the fee, and opens hosted Cashfree Sandbox checkout.
4. On checkout return, CleanSheet verifies the order and payment with Cashfree. The parent sees the fee marked paid and the coach dashboard moves that amount from outstanding to collected.
5. The team submits the hosted app, source, a 60–70-second recording, and the pitch material required at the briefing.

## Scope and stack

| Area | Sprint scope |
|---|---|
| App | A TypeScript Lambda Event function exposes the backend API through API Gateway. A coach dashboard, a parent fee page, and a sign-in entry point. English labels, one rehearsed desktop browser, responsive layout for both roles. |
| Identity and storage | Cognito hosted sign-in and DynamoDB. Seed one academy, one squad, one invented player, one authorised coach, and one linked parent per scenario. Keep business writes behind server routes. |
| Raz | Sarvam `saaras:v4` transcription and `sarvam-105b` with one permitted fee-preview tool. Validate the proposal on the server. |
| Payment | Cashfree PG Sandbox hosted checkout. Create an order for a stored fee, verify the provider on return or recheck, and apply success once. |
| Release | Real sandbox transaction, verified deployed build, short demo recording, and a four-slide pitch if the briefing calls for one. |

Keep full academy onboarding, roster editing, parent invites and review, full localisation, expense tracking, and recurring turf rent on the roadmap. The recurring **fee** workflow and signed billing webhooks are covered in the [Relay plan](BACKEND_RELAY.md). The Sarvam / Relay owner confirms sandbox and access constraints as part of [CS-07](../tickets/CS-07-pitch-and-submission.md).

## Demo data and visuals

- Use First Touch Academy, U12, and one test player. The sample fee is ₹1,500 (`150000` paise) for the configured demo month. Prepare a smoke scenario with an existing unpaid fee and a fresh recording scenario where the coach creates it. Use distinct order and fee references across scenarios.
- The fresh demo goes from zero expected, collected, and outstanding, to ₹1,500 expected and outstanding after confirmation, then ₹1,500 collected and ₹0 outstanding after verification.
- Use Space Grotesk for English and a font that covers the selected voice transcript. Preserve the palette `#17131E`, `#17191D`, `#597C80`, `#9E5C55`, and `#F2E9E7`. Prioritise readable fee amounts and obvious confirmation and payment states.

## Preflight and checkpoints

| When | Evidence or decision |
|---|---|
| Before the timed sprint | Confirm repo and AWS access, Cognito sign-in and the API Gateway URL, test accounts, Sarvam access, and Cashfree Sandbox checkout and verification access. Use only preparation permitted by organisers. Test video export and confirm submission requirements. |
| 12:30 PM | Confirm scope and claim the starter tickets on the [board](../tickets/README.md). Backend publishes the scaffold, Frontend builds against fixtures, and Cashfree and Sarvam smoke-test their providers in parallel. |
| 1:30 PM | Target one server-verified sandbox payment from the deployed smoke flow. Keep payment work on the critical path if this slips. |
| 2:40 PM | Target the joined Raz → confirm → pay → dashboard flow in a fresh scenario. Use the typed Sarvam fallback if recording fails. |
| 3:00 PM | Freeze features. Finish release checks and fixes, capture the working flow, and finish the deck. |
| 3:55 PM | Target submission and check the receipt before the 4:00 PM published cutoff. |

Release claims must match observed results. Keep an unresolved payment in a checking state. If the provider or browser blocks any step, record the available evidence and label the fallback used. See [CS-08 release QA](../tickets/CS-08-release-qa.md).
