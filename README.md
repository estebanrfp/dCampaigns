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

> **Status: working prototype.** The three sides, the full delivery lifecycle —
> brief, assign, deliver, reject with a reason, deliver again, approve, record
> what is owed — named assignment, attached evidence, bulk review, paged queues,
> live stats and passkey login all run. Covered by a Playwright suite where every
> simulated peer is its own browser context, so the P2P behaviour is actually
> exercised rather than simulated through shared storage.

## The product, in three sides

One product, three views over the same graph:

| Side | Who uses it | What they do |
| --- | --- | --- |
| **Admin panel** | The operator | Oversees the platform, arbitrates, moderates |
| **Client dashboard** | Clients | Brief campaigns, break them into tasks, assign and approve |
| **Creator dashboard** | Creators | Pick up work, deliver it with proof, keep their record |

Joining them: identity, roles as signed grants, campaign assignment, verdicts
and stats.

## The life of one delivery

Four claims by two people at four moments, and none of them overwritten:

1. **The delivery** — the creator's node, with the evidence attached and its
   fingerprint written in.
2. **The verdict** — a separate node owned by whoever decided it, carrying the
   reason if it came back.
3. **The next attempt** — a new node linked to the one it answers, numbered, so
   the history is a traversal rather than a foreign key the reader reassembles.
4. **The payment** — a signed statement by the payer, beside the approval.

A status column answers the first two by forgetting: a row walks
`pending → rejected → approved → paid`, and the moment the work is accepted
there is nothing left to say why it came back once. Here the rejected attempt
keeps the verdict that rejected it, reason included, and is still readable after
the second attempt has been paid for.

## Deciding many at once, and admitting it

A queue grows a "select all" the moment it is busy, and a backend records the
result as though it had not happened — fifty rows change `status`, and nothing
afterwards distinguishes fifty readings from one gesture.

So the act is a node of its own, signed by the reviewer and naming what it
covered, and every verdict it produced points back at it. Each delivery still
gets its own verdict, because a verdict is about one delivery and has to stand
alone. The batch adds only the honest part: *these were decided together*. A
centralised version does not withhold that out of malice — it has nowhere to put
it.

## The evidence, and which file was accepted

Proof of work used to be a URL, which is the last part of a delivery that still
asks the reviewer to trust somebody's server: it can 404, change hands, or serve
different bytes tomorrow than it served when the work was accepted.

The file travels instead, and the split follows its size. Anything small enough
rides in the graph and is on the reviewer's disk before they think to look,
readable with nobody online. Anything larger leaves its record in the graph —
name, size, digest — and keeps the bytes on the machine that made them, arriving
over a data channel when somebody asks. Evidence held that way is available when
its author is, which is exactly why the small case does not work that way.

Either way the digest is signed **into the delivery**, before any verdict exists,
so the record names the file that was accepted. A backend cannot make that claim:
whoever writes the row can swap the attachment afterwards, and the approval still
says approved — now about a different file. The suite performs that swap and
watches it fail to go unnoticed.

## A queue longer than the screen

Lists are a window, not a load: `$limit` with a cursor that is a node id rather
than an offset, so a delivery arriving while somebody reads page two does not
shuffle the page under them. The window stays a subscription — the engine reports
nodes entering and leaving it — so a page is bounded and current at once, which a
paged read normally is not.

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
way — and signs an approval of their own work. It reaches connected peers and
changes nothing. The engine re-checks authorship wherever state is applied, so
the node the client stored is never rewritten; and a verdict whose reviewer is
the delivery's own creator is refused on sight. The test reads the client's
graph directly, with no interface in between: the forgery propagates, and the
stored verdict still reads `rejected`.

## Isolation is authorship

One graph carries the whole marketplace — one database per project, the engine's
own recommendation. A client space is a catalogue node the engine stamps as its
creator's, and every campaign, task, delivery and verdict inside it carries an
owner of its own, re-checked by every peer on every path state can arrive by:
live operations and reconciliation alike. What keeps one client's work theirs is
the signature on it, not distance from anyone else.

Everything replicates to everyone, and that is worth stating rather than hiding:
a signature protects integrity and authorship, not secrecy. What one identity
keeps to itself travels as a field encrypted for its own key, opaque on every
other peer.

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
