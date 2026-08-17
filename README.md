# dCampaigns

A platform for running paid creator campaigns on X — built as a **distributed
application**: no backend, no server to trust, and no account to create. The
data lives in a signed graph replicated between the peers that use it.

> **Status: scaffolding.** Nothing is built yet. The scope below is the brief,
> not a description of working software.

## The product, in three sides

One product, three views over the same graph:

| Side | Who uses it | What they do |
| --- | --- | --- |
| **Admin panel** | The operator | Oversees the platform, arbitrates, moderates |
| **Project dashboard** | Clients | Create and manage campaigns |
| **Creator dashboard** | Creators | Receive tasks, submit posts and proofs |

Joining them: identity and roles, campaign assignment, approvals and stats.

**Deferred, by the client's own call:** X data collection, a Telegram bot, and
a USDC flow on Base.

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
