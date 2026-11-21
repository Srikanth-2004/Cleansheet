# CS-01 · Scaffold and deploy

**Owner** [Backend](../roles/02-backend.md) · **Start dependency** Repo access at the permitted build start

## Work

- Create one minimal TypeScript Firebase Functions scaffold in the shared repo. Own the root config, lockfile, `.env.example`, and the Firebase project config. Publish the API scaffold early and give the endpoint and contract to CS-05.
- Document the required configuration names for Firebase browser configuration, Firestore, Sarvam, and Cashfree Sandbox. Configure credentials through the intended host and keep secrets out of the repo.
- Give builders the local start/build commands, merge-base commit, and the intended Firebase HTTPS function URL. Coordinate the Firebase Auth sign-in domain with CS-02 and checkout return URL with CS-03.

## Acceptance and handoff

- [ ] One shared commit builds and starts locally.
- [ ] The health endpoint is reachable over HTTPS on the intended host.
- [ ] CS-02 through CS-05 have the merge base. CS-08 has the host URL and commit.

Provider smoke checks and UI fixtures can begin while the shell is being published. See the [repo structure](../README.md) and [sprint stack](../docs/SPEC.md#scope-and-stack).
