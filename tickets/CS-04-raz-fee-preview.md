# CS-04 · Raz fee preview

**Owner** `@jv-013` ([Sarvam](../roles/04-sarvam.md)) · **Status** `MERGEABLE` (branch `cs-05-coach-and-parent-ui`) · **Start dependency** Sarvam key and one sample utterance

## Work

- Pick Hindi or Kannada for the demo with the teammate who will speak. Smoke-test a short recording against Sarvam STT. Then run the transcript through Sarvam tool calling with one fee-preview tool.
- Own the Sarvam adapter under `src/lib/providers/` and `POST /api/raz/fee-preview`. Use the actor and seeded squad scope, validate the period and paise amount, and return the response in the [contract](../docs/CONTRACT.md).
- Send typed text through the same interpretation path. Return a retry message when the request is ambiguous or invalid. The endpoint only prepares a proposal.

## Acceptance and handoff

- [ ] The sample voice clip and its typed equivalent produce the expected ₹1,500 preview. *(Typed Hindi & Kannada verified live on `sarvam-105b`; `saaras:v4` STT endpoint verified; Lambda handler wired with `getActor` & multipart tests.)*
- [x] Ambiguous or invalid input prompts a retry and creates zero fee records.
- [ ] Share the language, sample utterance, response, and observed test outcome with [CS-05](CS-05-coach-and-parent-ui.md) and [CS-08](CS-08-release-qa.md).

**Handoff note:** `CS-04 | @jv-013 | MERGEABLE | branch: cs-05-coach-and-parent-ui | src/lib/providers/sarvam.ts wired into src/lambda.ts & /api/raz/fee-preview; npm test & smoke:sarvam passed | Blocker for VERIFIED: SarvamSecretArn on AWS stack & live mic test`

Work can start independently of [CS-03](CS-03-cashfree-checkout.md). Hosted acceptance uses the [CS-01](CS-01-scaffold-and-deploy.md) deploy, the [CS-02](CS-02-auth-and-fee-state.md) auth helper, and the CS-05 inputs. [Sarvam tool-calling reference](https://docs.sarvam.ai/api/token-factory/chat-completions#tool-calling-function-calling)
