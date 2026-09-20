# D-P6-DERIVATION-MULTIGRANT — an unordered `limit 1` let row order decide governance

**Classification: PRODUCT GOVERNANCE DEFECT, PRE-EXISTING P6-IG, EXPOSED BY THE SLICE 14 BATCHING WORK.**
**Status: ACCEPTED / CLOSED. Corrected in `e55499b`; permanent coverage added at Slice 14 closeout.**
No schema, no migration, no alias movement, no P45, no hosted action.

> **Multiple live qualifying derivation grants compose by UNION: each independently confers only what
> it permits, and a narrower sibling cannot deny by being looked at first.**

## 1. What was wrong

The one-row derivation-grant loader in `src/lib/pursuits/federation/derivation.ts` ended:

```sql
   and (expires_at is null or expires_at > coalesce($6::timestamptz, transaction_timestamp()))
 limit 1
```

with **no `order by`**. PostgreSQL therefore guaranteed nothing about *which* qualifying grant it
returned — and the pick decides the answer, because grants differ in `retention_class` and in
`scope.keys`. A viewer holding a broad grant and a narrow one could be refused a derivation the broad
grant plainly permitted, on the strength of physical row order.

It was found while extracting `decideDerivation` as a pure core: the batched loader naturally returns
*every* qualifying grant, which made the one-row loader's arbitrary single pick visible as a
difference between two paths that were supposed to be the same rule.

## 2. The correction

`decideDerivation` considers **every** qualifying grant and allows if any of them permits, which is
what *"a live grant covers this purpose and class"* means. Both fact loaders `order by id`, so no
query can return an arbitrary row; `mayDerive` was rewritten onto the same core, so the change lands
on both paths identically.

**First-by-id is deterministic DIAGNOSTIC selection, not precedence.** The ordering exists so that
the grant a decision *names* is stable and can be cited in an explanation. No grant outranks another:
when two grants each independently permit, deleting the named one changes the citation and leaves the
decision ALLOW.

## 3. Evidence

Unit — `tests/d-s14-batched-governance.test.ts` pins the core on hand-built facts, including
*"with several qualifying grants, a narrower one no longer denies by being first"*.

Database — `scripts/dp6-multigrant-verify.ts`, the SEEDED_CLONE suite **`dp6-multigrant`**, **38 / 0**
under a real `app_rw` session:

- **the historical selector as a negative control**, kept verbatim and never called by product code.
  The bite is taken by **enumeration**: against a two-grant fixture the core's verdict on each
  qualifying grant *alone* is one ALLOW and one DENY — exactly the choice set an unordered `limit 1`
  was free to return — while the union rule allows. **Which row the control actually returns is
  deliberately not asserted**, because pinning today's heap order would be pinning the defect.
- **structural**: the product reads `context_grants` in three places — two decision reads and one
  set-building allow-list read. Both decision reads order by `id` and take no limit; the set read
  takes no limit either, since ordering a set is meaningless but dropping a row from it is not.
- **two-path discrimination across eleven grant shapes** — permitting; narrowed; narrowed +
  permitting; two narrowed covering neither; RETAINED + PURSUIT_LIFETIME on a merged pursuit;
  PURSUIT_LIFETIME alone on a merged pursuit; expired + live; wrong + right purpose; wrong + right
  class; revoked + live; and no grant at all — asserting the same decision, the same named grant, the
  same retention and the same refusal reason from both loaders, with an anti-vacuity check that the
  cases produced both ALLOW and DENY.
- **citation, not precedence**: the named grant is the lowest id, is stable across repeated
  evaluation, and deleting it leaves the decision ALLOW with a new citation.

## 4. What this does not claim

The union rule is about **grants of the same kind composing**, not about widening what a grant covers.
Purpose, governed information class, expiry, revocation, participation and pursuit liveness are each
still matched **per grant**; a grant that fails any of them is not qualifying and contributes nothing.
Nothing here relaxes the P6-IG semantic firewall between `information_classes` (legacy disclosure) and
`governed_information_classes` (machine-evaluable), which remains the only column the derivation path
reads.
