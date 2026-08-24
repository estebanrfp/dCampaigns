# dCampaigns

A platform for running paid creator campaigns on X — built as a **distributed
application**: no backend, no server to trust, and no account to create. The
data lives in a signed graph replicated between the peers that use it.

> **Status: working prototype.** The three sides, the campaign → task →
> submission → approval cycle, named assignment, live stats and passkey login all
> run. Covered by a Playwright suite where every simulated peer is its own
> browser context, so the P2P behaviour is actually exercised rather than
> simulated through shared storage.

## The product, in three sides

One product, three views over the same graph:

| Side | Who uses it | What they do |
| --- | --- | --- |
| **Admin panel** | The operator | Oversees the platform, arbitrates, moderates |
| **Project dashboard** | Clients | Create and manage campaigns |
| **Creator dashboard** | Creators | Receive tasks, submit posts and proofs |

Joining them: identity and roles, campaign assignment, approvals and stats.

**Out of scope for this build:** collecting reach and impressions from X, a
Telegram bot, and an on-chain payment flow. Each needs an outside service; the
point here is what the distributed core can carry on its own.

## Why distributed

The centralised version of this is a backend with a user table and a permission
check in every endpoint. Here there is no endpoint to check: a role is a
**signed grant** that travels as data, and every peer verifies it against the
signer's key. An approval is not a server saying yes — it is a signed operation
anybody can verify, including the creator who was paid on the strength of it.

That distinction is the whole point of the build, and it shapes the model from
the first line: *"the admin approves a submission"* has to be designed as data,
not as a permission gate. GenosDB's own examples carry the patterns —
`docs.html` for node-level ACLs in a real app, `governance.html` for how a role
is earned, `rbac-chat.html` for what a role actually grants.

## The verdict belongs to whoever signed it

The interesting problem in a campaign tool is not storing an approval — it is
making one that cannot be forged. A submission is the creator's node and is never
rewritten by the reviewer; the verdict is a **separate node** owned by whoever
decided it. Two different claims by two different people, each standing on its
own.

The suite tests that adversarially, not politely: a rejected creator runs a
tampered client — their own key, a second database instance, no interface in the
way — and signs an approval of their own work. Two rules keep it out. Nobody
decides on their own delivery, so a verdict whose reviewer is the creator is
refused on sight. And each party keeps its own copy of what it signed outside the
replicated graph, so the screen that matters is drawn from a record no peer can
reach. The forgery propagates; the client's dashboard still reads `rejected`.

## Stack

- **[GenosDB](https://genosdb.com)** — the graph, the sync, the identity and the roles. One dependency.
- **Vite** + vanilla JavaScript (ES2022+), matching the rest of the ecosystem's apps.

## Getting started

```bash
pnpm install
pnpm dev
```

## Author

Esteban Fuster Pozzi (@estebanrfp) - Full Stack JavaScript Developer
