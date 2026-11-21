# CS-01 · Scaffold and deploy

**Owner** [Backend](../roles/02-backend.md) · **Start dependency** Repo access at the permitted build start

## Work

- Create one minimal TypeScript Lambda scaffold in the shared repo. Own the root config, lockfile, `.env.example`, and the AWS SAM deployment template. Publish the buildable scaffold early and give ownership of the UI shell to CS-05 after handoff.
- Document the required configuration names for Cognito browser configuration, DynamoDB, Sarvam, and Cashfree Sandbox. Configure credentials through the intended host and keep secrets out of the repo.
- Give builders the local start/build commands, merge-base commit, and the intended Lambda app URL. Coordinate the Cognito sign-in domain with CS-02 and checkout return URL with CS-03.

## Acceptance and handoff

- [ ] One shared commit builds and starts locally.
- [ ] The shell is reachable over HTTPS on the intended host.
- [ ] CS-02 through CS-05 have the merge base. CS-08 has the host URL and commit.

Provider smoke checks and UI fixtures can begin while the shell is being published. See the [repo structure](../README.md) and [sprint stack](../docs/SPEC.md#scope-and-stack).
