# CleanSheet

CleanSheet helps football academies collect fees and track payments. For the buildathon, a coach gives Raz a fee request in Hindi or Kannada and confirms the preview. A test parent pays through Cashfree Sandbox, and the coach dashboard updates after the server verifies the payment.

The backend plan adds recurring fees with Cashfree Subscriptions, Secure ID for adult contact verification, Payment Gateway checkout and refunds, and Cashfree Relay for payment follow-up and calls powered by Sarvam.

## Start here

- [Relay backend plan](docs/BACKEND_RELAY.md) and [billing integration contract](docs/RELAY_CONTRACT.md)

- [Sprint spec](docs/SPEC.md), [shared API contract](docs/CONTRACT.md), and [architecture](docs/ARCHITECTURE.md)
- [Ticket board](tickets/README.md) and [project wiki](https://github.com/Srikanth-2004/Cleansheet/wiki)

## Four-person split

[Frontend](roles/01-frontend.md) · [Backend](roles/02-backend.md) · [Cashfree](roles/03-cashfree.md) · [Sarvam / Relay](roles/04-sarvam.md)

## Folder template

`src/app/` holds screens and API routes, `src/components/` holds shared UI, `src/contracts/` holds shared types, and `src/lib/` holds client, server, and provider code. `scripts/` is for seed and smoke checks, and `deliverables/` is for release records. [CS-01](tickets/CS-01-scaffold-and-deploy.md) covers the app scaffold.
