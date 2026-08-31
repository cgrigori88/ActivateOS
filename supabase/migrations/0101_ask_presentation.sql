-- TD SYNNEX pre-demo, Ask UX normalization.
--
-- The Ask room reads its history back from this table, so an answer's executive framing has to be
-- persisted alongside it — re-deriving it would mean re-running the query against a record that may
-- have moved on, and an audit row that changes when you reread it is not an audit row.
--
-- `significance` is a COMPUTED figure with its basis: the resolver's own sum over the rows it
-- returned, plus a sentence stating what was summed. It is frequently null, and that is correct —
-- a resolver with no honest single figure (a list of ledger changes, a partner activation profile)
-- stores none, and the surface shows none rather than reaching for a number.
--
-- `next_action` is a deep link into a canonical room, never an instruction to a person.
--
-- Both are nullable and additive; rows written before this migration stay valid.

alter table ask_exchanges add column if not exists significance jsonb;
alter table ask_exchanges add column if not exists next_action  jsonb;

-- Parts of a question the answering intent could not represent. Persisted so the Ask room can say
-- so on a re-read: an answer that quietly ignored a clause is a wrong answer with a right-looking
-- shape, and the log has to carry that as much as the screen does.
alter table ask_exchanges add column if not exists unapplied jsonb;
