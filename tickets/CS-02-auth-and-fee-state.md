# CS-02 · Firebase Auth, seed, and fee state

**Owner** [Backend](../roles/02-backend.md) · **Start dependency** Firebase project and test identities

## Work

- Start with the written [contract](../docs/CONTRACT.md). Own `functions/src/contracts/`, the server-side Firebase Auth verification and Firestore fee store modules, `functions/scripts/seed-demo.ts`, and the identity, fee, and summary routes listed for CS-02.
- Set up Firebase Auth sign-in for the nominated test users and the deployed host. Verify tokens server-side and enforce coach and linked-parent access for each operation. Use Firestore transactions for unique fee creation, checkout reservation, and payment application.
- Seed one unpaid smoke fee and a fresh scenario for the final run. Seed a new scenario with distinct provider references if QA or filming needs another complete payment. Keep reset and seed commands private.
- Implement the auth helper and the three payment store functions in the contract. Keep provider calls outside store transaction callbacks.

## Acceptance and handoff

- [ ] The test coach and parent sign in. An unlinked parent or out-of-scope fee request is denied.
- [ ] Confirming the same fee twice creates one record. A different amount for the same player and period conflicts.
- [ ] A repeated verified payment changes the fee and dashboard totals once.
- [ ] Share auth/store exports with [CS-03](CS-03-cashfree-checkout.md) and [CS-04](CS-04-raz-fee-preview.md) as applicable. Give [CS-05](CS-05-coach-and-parent-ui.md) and [CS-08](CS-08-release-qa.md) the scenario ID, month, and a secure way to use the test accounts.

Account setup and store design can start immediately. Merge on the [CS-01](CS-01-scaffold-and-deploy.md) scaffold.
