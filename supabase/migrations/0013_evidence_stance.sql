-- Evidence stance (contradiction detection wiring).
--
-- Until now every evidence item sharing a claim fingerprint was treated as
-- MUTUAL SUPPORT, and verifyEvidence hardcoded `contradictions: 0`. A source
-- can also DISPUTE a claim — e.g. a Tavily investigation that finds no support
-- for, or evidence against, a cheap radar lead. `stance` records that, so the
-- verifier can count refuting sources and apply the contradiction penalty.

alter table evidence
  add column if not exists stance text not null default 'supports'
    check (stance in ('supports', 'refutes'));

-- Fingerprint + stance is the corroboration/contradiction lookup key.
create index if not exists evidence_fingerprint_stance_idx
  on evidence (claim_fingerprint, stance)
  where claim_fingerprint is not null;

-- A basis value for research-driven refutations recorded in `contradictions`.
-- (The column is free text; this comment documents the convention.)
