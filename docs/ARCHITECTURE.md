# Architecture and execution diagrams

See the [sprint spec](SPEC.md), the active [Relay backend plan](BACKEND_RELAY.md), and the [Relay integration contract](RELAY_CONTRACT.md).

## Relay and recurring fees

```mermaid
flowchart LR
    Parent["Linked parent"] -->|Consent and authenticated choice| App["CleanSheet backend"]
    Coach["Coach"] -->|Review records and approve refunds| App
    App <-->|Verification reference| Secure["Cashfree Secure ID"]
    App -->|Authorise, schedule or cancel| Sub["Cashfree Subscriptions"]
    App -->|Checkout, recovery link or refund| PG["Cashfree Payment Gateway"]
    Sub -->|Signed outcome| App
    PG -->|Signed outcome| App
    App <-->|Billing state and auditable actions| Store[("Firestore")]
    App -->|Approved action via supported setup| Relay["Cashfree Relay with Sarvam voice"]
    Relay -->|Reminder or eligible retry| Parent
    Relay -->|Confirmed cancellation call| Coach
    App -->|Verified payment notification| Coach
```

The Relay route and observed outcomes depend on merchant access. The backend owns financial state and verifies Cashfree events.

## Base app and first payment checkpoint

```mermaid
flowchart LR
    Coach["Coach UI"]
    Parent["Parent UI"]
    Auth["Firebase Auth"]

    subgraph App["Next.js on Vercel"]
        Raz["Raz fee preview"]
        Fees["Fee creation and dashboard"]
        Payment["Checkout and payment verification"]
    end

    Sarvam["Sarvam speech-to-text and tool calling"]
    DB[("Firestore: roles, fee records, payment state")]
    Cashfree["Cashfree Sandbox"]

    Coach -->|Sign in| Auth
    Parent -->|Sign in| Auth
    Coach -->|Audio or text and ID token| Raz
    Raz <-->|Transcription and fee proposal| Sarvam
    Raz -->|Fee preview| Coach
    Coach -->|Confirm fee| Fees
    Fees <-->|Create fee and read totals| DB
    Parent -->|Load linked fee| Fees
    Parent -->|Request checkout session| Payment
    Payment -->|Create order for stored fee amount| Cashfree
    Payment -->|Return checkout session| Parent
    Parent -->|Pay on hosted checkout| Cashfree
    Parent -->|Verify on return or recheck| Payment
    Payment -->|Fetch order and payment status| Cashfree
    Payment -->|Apply verified payment once| DB
    Coach -->|Refresh collections| Fees
```

## Ticket execution and handoffs

The arrows into a checkpoint show what must come together for live verification. Code can be developed using the written contract and fixtures before the merge base and neighboring routes are ready.

```mermaid
flowchart TD
    Start["12:30 PM · Claim starter tickets"]
    Start --> Base["Backend · CS-01 scaffold and deployment"]
    Start --> Pay["Cashfree · CS-03 test checkout with a fixture fee"]
    Start --> UI["Frontend · CS-05 build both screens with fixtures"]
    Start --> Voice["Sarvam · CS-04 test Raz with a sample clip"]

    Base -->|Merge base| Store["CS-02 · Firebase access and seeded fee state"]
    Store --> Smoke["1:30 PM target · Verify one deployed sandbox checkout"]
    Pay --> Smoke
    UI -->|Checkout screen| Smoke

    Smoke --> Demo["2:40 PM target · Voice preview to verified payment"]
    Voice --> Demo
    UI -->|Preview and confirmation| Demo
    Demo --> QA["3:00 PM feature freeze · Backend verifies release"]

    QA --> Capture["Frontend · CS-06 capture and export the verified flow"]
    QA --> Submit["Sarvam · CS-07 submit by 3:55 PM"]
    Capture --> Submit
```

The [ticket board](../tickets/README.md) lists which owners can start immediately and the dependencies for live acceptance.
