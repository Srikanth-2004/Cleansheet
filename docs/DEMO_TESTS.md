# CleanSheet demo checks

Use the **Local Fixtures** controls for the browser walkthrough. Firebase Emulator tests exercise the backend separately with mock provider responses. Use Cashfree Sandbox credentials for actual provider calls.

| Check | Steps | Expected result |
| --- | --- | --- |
| Pay a fee | Open the parent view, select **Smoke ₹1,500**, choose **Pay**, then **Complete Sandbox Payment & Return**. | The fixture fee changes to paid. The coach’s **Who paid** section lists Demo Player and ₹1,500. |
| Payment pending | Reset **Smoke ₹1,500**. Start checkout and choose **Return as Processing**. Switch **Verify** to **Paid**, then choose **Recheck Payment Status**. | The fee stays processing until rechecked. The coach receives one payment notice when the fee is paid. |
| Keep a subscription | In **Smoke ₹1,500**, choose **Keep Mandate**. | The decision is recorded for the current cycle. No payment is recorded by this action. |
| Decline cancellation | Choose **Cancel Mandate** to open the prompt. Select Hindi, Kannada, or English and choose **No**. | The subscription remains active. The coach receives no cancellation notification. |
| Confirm cancellation | Choose **Cancel Mandate** and confirm **Yes**. Open the coach view. | The demo subscription is cancelled and the coach gets one cancellation notice. The Firebase backend waits for verified provider cancellation before adding that notice. |
| Voice answer | In the cancellation prompt, select English, Hindi, or Kannada and choose **Play prompt**. Then record a short answer. | The app plays the matching Sarvam Bulbul v4 Flash clip bundled in the web app. When speech recognition is configured, Saaras recognizes the spoken Yes or No. The parent confirms on screen. |
| View recovery | Select **Recovery** in the parent view. | The demo shows the recovery link for a failed debit. |
| Reconcile a refund | In the coach view, select **Refund ₹500**, then approve the fixture refund. | Net collected changes from ₹1,500 to ₹1,000 in the fixture. The backend updates net collected after verified refund settlement. |
| Preview a fee with Raz | Say or type “Create this month’s fee” and preview it. | Sarvam Token Factory recognizes the fee request, and Firebase proposes the standard ₹1,500 for the selected month. An explicit amount overrides the standard fee. Confirm the preview before the fee is saved. |
| Send a fee by voice | Record a fee request, listen to the preview, then select **Send by voice**, say “Send fee”, and choose **Stop & Send**. | Firebase publishes the previewed amount and month to the linked parent. A negated or unclear command leaves the preview open. |
| Ask who paid in Hindi | In Raz, type `कितने लोगों ने फीस भरी है?` and send it. Select **Listen to payment count** to hear the answer. | The answer uses the coach's verified Firebase ledger. Sarvam speaks the count in Hindi with the provider key configured. Browser fixture payments are separate. |
| Verify role access and idempotency | Run the Firebase emulator smoke script. | A parent is denied the coach API. Duplicate payment and cancellation events produce one notice each. |

## Firebase logs

Open **Cashfree API hits** in the local app header or visit `http://localhost:3000/cashfree-hits`. The page shows Cashfree operations, HTTP status, response summaries, backend usage, and request IDs from the Firebase emulator. A skipped entry means Cashfree received no request.

Open the Firebase Emulator Suite at `http://localhost:4000/logs`. Search for `CleanSheet API hit` and `CleanSheet provider hit`. The request ID is also returned as `X-Request-Id`, so you can match an API response to its Cashfree, Sarvam, or MCP activity. A `CleanSheet provider skipped` entry means the backend stopped before calling that provider, for example because the provider secret is missing. Fixture clicks that run entirely in the browser have no provider call to log.

For a live Sandbox call, add only the required provider credentials to the emulator-only `functions/.env.local` and restart the emulators. For deployed functions, use Secret Manager and view the same structured events in Firebase Functions logs.

For checkout, set `CLEANSHEET_CASHFREE_PG_SECRET_LOCAL` to a JSON object with `clientId` and `clientSecret` from the Cashfree Payment Gateway Sandbox. Use a Firebase-backed parent checkout to generate an outbound hit. Set `CLEANSHEET_SARVAM_SECRET_LOCAL` to the Sarvam API key for local speech recognition and synthesis.

If recording shows a browser permission error, open localhost directly in a regular browser and verify microphone access for localhost. Typed input and the confirmation buttons cover the same local decision tests.
