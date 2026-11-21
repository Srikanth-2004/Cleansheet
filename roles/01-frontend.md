# Person 1 · Frontend

**Primary ticket** [CS-05 · Coach and parent UI](../tickets/CS-05-coach-and-parent-ui.md)

**Release duty** [CS-06 · Demo video](../tickets/CS-06-demo-video.md)

## Current assignment

Use the [billing fixtures](../docs/RELAY_CONTRACT.md#fixture-scenarios) immediately. Add the parent contact verification and outreach consent, hosted mandate launch, keep/cancel actions, and pending states to the existing flow. Add the coach's success notification and cancellation/refund status. Wire the parent decision through the authenticated app, including when a call sends the parent to the app. Coach confirmation owns refund approval. Handoff the UI and capture path to Backend QA and Sarvam / Relay.

## Start independently

1. Use the [contract fixtures](../docs/CONTRACT.md#fixture-handoff) to build the sign-in entry, coach fee preview and confirmation, dashboard totals, and parent fee and checkout states. Roll these into the shared scaffold when Backend hands it over.
2. Own UI routes, `src/components/`, the Firebase browser client, the browser recorder, and local UI fixtures. Capture the actual audio MIME type supported by the demo browser. Keep typed input usable through the same preview path.
3. Connect Backend's identity and fee routes first and wire Cashfree checkout as soon as the sandbox session route is available. Smoke payment can run with the seeded unpaid fee while you connect the Raz preview.

## Handoffs

| From | What you need | What you can use meanwhile |
|---|---|---|
| Backend | Scaffold, test accounts, smoke fee, identity/fee/summary endpoints | Contract-shaped role and fee fixtures |
| Cashfree | Checkout session, return path, verify/recheck route | Local checking and paid responses |
| Sarvam | Preview endpoint, tested language and sample utterance | Local fee preview response |

**Done when** both roles can be exercised with fixtures, then with real routes on the deployed app. Give Backend the tested demo URL, browser, and run sequence. Keep the video edit simple. After Backend verifies the release, capture a 60–70-second clip with the sandbox label visible and hand it to Sarvam for submission.
