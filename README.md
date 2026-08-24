# dCampaigns

Commissioning work from creators — briefing it, assigning it, delivering it and
approving it — built as a **distributed application**: no backend, no server to
trust, and no account to create. The data lives in a signed graph replicated
between the peers that use it.

> **Status: working prototype.** The three sides, the campaign → task →
> delivery → verdict cycle, named assignment, live stats and passkey login all
> run. Covered by a Playwright suite where every simulated peer is its own
> browser context, so the P2P behaviour is actually exercised rather than
> simulated through shared storage.

## The product, in three sides

One product, three views over the same graph:

| Side | Who uses it | What they do |
| --- | --- | --- |
| **Admin panel** | The operator | Oversees the platform, arbitrates, moderates |
| **Client dashboard** | Clients | Brief campaigns, break them into tasks, assign and approve |
| **Creator dashboard** | Creators | Pick up work, deliver it with proof, keep their record |

Joining them: identity, roles as signed grants, campaign assignment, verdicts
and stats.

## Why distributed

The centralised version of this is a backend with a user table and a permission
check in every endpoint. Here there is no endpoint to check: a role is a
**signed grant** that travels as data, and every peer verifies it against the
signer's key. An approval is not a server saying yes — it is a signed operation
anybody can verify, including the creator whose work was accepted on the
strength of it.

That distinction shapes the model from the first line: *"the client approves a
delivery"* has to be designed as data, not as a permission gate.

## The verdict belongs to whoever signed it

The interesting problem here is not storing an approval — it is making one that
cannot be forged. A delivery is the creator's node and is never rewritten by the
reviewer; the verdict is a **separate node** owned by whoever decided it. Two
different claims by two different people, each standing on its own.

The suite tests that adversarially, not politely: a rejected creator runs a
tampered client — their own key, a second database instance, no interface in the
way — and signs an approval of their own work. Two rules keep it out. Nobody
decides on their own delivery, so a verdict whose reviewer is the creator is
refused on sight. And each party keeps its own copy of what it signed outside
the replicated graph, so the screen that matters is drawn from a record no peer
can reach. The forgery propagates; the client's dashboard still reads
`rejected`.

## Isolation is transport, not permission

Each client works in its own room, joinable only by a peer holding its access
code — the code encrypts the signaling, so without it the handshake never
completes and no replica is ever exchanged. An ACL denying `read` would not do
this: in a shared room the data still reaches every peer's disk.

## Stats without a service

Every figure — deliveries, verdicts, approval rate, median time to decide — is
computed on the device from signed operations, so anyone can check it against
their own replica. Audience metrics are deliberately absent: they live on the
platform where the work was published, and no peer can verify them.

## What this deliberately does not do

Anything that needs an outside service to be true: pulling audience figures from
a publishing platform, notification bots, on-chain payment. Each is a straight
integration, and none of it says anything about the question this prototype
exists to answer — how much of a three-sided marketplace the distributed core
can carry on its own.

## Stack

- **[GenosDB](https://genosdb.com)** — the graph, the sync, the identity and the roles. One dependency.
- **Vite** + vanilla JavaScript (ES2022+), matching the rest of the ecosystem's apps.

## Getting started

```bash
pnpm install
pnpm dev
```

Run the suite — every peer in its own browser context:

```bash
pnpm exec playwright test
```

## Author

Esteban Fuster Pozzi (@estebanrfp) - Full Stack JavaScript Developer
