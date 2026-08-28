# dCampaigns

Commissioning work from creators — briefing it, assigning it, delivering it and
approving it — built as a **distributed application**: no backend, no server to
trust, and no account to create. The data lives in a signed graph replicated
between the peers that use it.

**[Try it →](https://estebanrfp.github.io/dCampaigns/)**

The page is the whole application: nothing runs behind it. Open it in two
browsers and they become peers of each other — the second is not talking to a
server, it is talking to the first. Sign in as the operator with one click, or
create an identity and declare a side; a role has to be signed by a superadmin,
so keep the operator's window open while a newcomer is promoted.

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

- **[GenosDB](https://genosdb.com)** — the graph, the sync, the identity and the roles. The only runtime dependency, loaded from the CDN.
- Vanilla JavaScript (ES2022+), native ES modules, **no build step** — the same zero-build shape as the rest of the ecosystem's examples. What is in the repository is what runs.

## Getting started

Any static server will do; the files are served as they are.

```bash
python3 -m http.server 5173
```

Run the suite — every peer in its own browser context:

```bash
pnpm install && pnpm test
```

And against the published site, which is where the sub-path and the cross-origin
engine are actually exercised:

```bash
TARGET_URL=https://estebanrfp.github.io/dCampaigns/ pnpm test
```

## Author

Esteban Fuster Pozzi (@estebanrfp) - Full Stack JavaScript Developer
