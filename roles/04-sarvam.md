# Person 4 · Sarvam integration

**Primary ticket** [CS-04 · Raz fee preview](../tickets/CS-04-raz-fee-preview.md)

**Release duty** [CS-07 · Pitch and submission](../tickets/CS-07-pitch-and-submission.md)

## Start independently

1. Pick Hindi or Kannada with the teammate speaking in the demo. Smoke-test `saaras:v4` transcription on one short clip and `sarvam-105b` with one fee-preview tool. Prepare the typed equivalent of the same command.
2. Own the Sarvam adapter and `POST /api/raz/fee-preview`. Accept multipart audio or typed JSON per the [contract](../docs/CONTRACT.md#http-routes). Validate the amount in paise and the period. Return the preview to Frontend for explicit confirmation. The preview performs zero fee writes.
3. Coordinate with Frontend on recorder format, the tested utterance, and the typed fallback. Wire the coach auth helper when Backend publishes it. Sarvam can be tested while Cashfree is in progress.

## Handoffs

| With | What to exchange |
|---|---|
| Backend | Coach auth helper in. Observed voice and text results for release QA out. |
| Frontend | Tested locale, sample utterance, response shape, and retry behavior. Collect the final clip for submission. |
| Cashfree | Collect the verified sandbox result from release QA for the pitch and submission. |

**Done when** the sample clip and typed equivalent both return the expected ₹1,500 preview, and ambiguous input returns a retry message. At the briefing, confirm the track, sandbox acceptance, and submission requirements. Keep a simple deck skeleton, then use the verified release and Frontend's video to submit by **3:55 PM IST**.
