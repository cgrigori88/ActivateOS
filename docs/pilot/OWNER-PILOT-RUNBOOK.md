# Owner pilot runbook

What the owner does, in order, with no engineer and no SQL. Every step is a product path; where one
is not yet reachable from the UI, that is stated rather than glossed.

## 0. Before the first import

External sending is **disarmed** and stays that way for this slice. Nothing here can email anyone.

## 1. Create the pilot operating context

`/admin` → **Create organization** → name it, and choose **Pilot — real-world activity** as the data
environment.

The environment is the one decision that keeps real pursuits out of the demo world, so it is made
once, by a person, at creation. There is **no default**: an organization nobody classifies stays
unclassified, and its imports stay unclassified with it. Creation makes you its owner and switches
you into it in the same transaction — a context you are not in is a trap.

## 2. Switch between contexts

The organization switcher offers **only organizations you are a member of**. The choice rides in a
cookie, but the cookie is a preference, not a grant: every read re-checks it against your
memberships, so a hand-edited value falls back to your own organization rather than reaching
another. Your **role follows the selected organization** — being an owner in one does not make you
one in another.

## 3. Load the first data

Three files, in this order, through `/intake`:

| # | File | Columns the parser understands |
| --- | --- | --- |
| 1 | **Accounts** | Company · Domain · Industry · Employees · Target Product · Contact Email · Contact Name · Contact Title |
| 2 | **CRM opportunities** | Company · Opportunity Name · Deal Stage · Deal Value · Close Date |
| 3 | *(contacts ride on the accounts file)* | — |

Upload → map the columns → review → commit. **Company is mandatory**; an upload that maps nothing to
it is refused before a single row is written.

Two things are taken from the server and cannot be supplied by the file: **the provenance** (from
the organization) and **the uploader** (from your session). A CSV cannot declare itself PILOT,
PRODUCTION, DEMO or CERTIFICATION.

**Re-importing the same file is safe.** Identity matching recognises the accounts and records them as
matched rather than creating them again.

## 4. Work the imported world

`/` (Today) and `/pipeline` show the imported accounts and opportunities through the ordinary
product. Ranked cards carry `#3 of 18` — the portfolio rank, with the comparison set it came from.

Pressing a card's primary button records **one attention observation**: that you deliberately chose
this pursuit for work, from this surface, where these were the displayed facts. It records the **P2
rank** and the **position on the page** as two separate numbers, because on Today they are different
numbers. Opening a pursuit any other way — a link, the back button, a pasted URL — records nothing.

It does **not** mean you agreed with the ranking, and it never claims the ranking caused anything.

## 5. Undo a bad import

`/intake` → the batch → **Reverse**. No SQL, and no guessing at which rows came from which file.

What reversal does, and what it refuses to do:

| | |
| --- | --- |
| Rows this batch created and nothing has touched | **removed** |
| Accounts the batch matched rather than created | **kept** — reversing an import must not delete what it found |
| A field this batch filled, still holding that value | **emptied again** |
| A field someone has since corrected | **kept** — your later work wins, and the outcome says so |
| An opportunity a pursuit now depends on | **kept** — it is not import residue any more |
| Companies and aliases | **always kept**, and reported |

That last row is a rule, not an optimisation. `companies` is shared identity infrastructure with no
owning organization; deleting one because your import is being undone would reach into other
tenants. The reversal tells you how many were retained instead of hiding them.

**History is never erased.** The batch, everything it did, and the outcome of every reversal step —
including the ones that refused — all remain. Reversal compensates; it does not pretend the import
never happened.

Reversing twice is safe: the second attempt reports and does not act again.

## 6. Invite someone else

`/admin` → **Members**. Creates the account, adds the membership, sets the role, and removes it
again. The last owner cannot be demoted. This subsystem already existed and was not rebuilt.

## Scale

Certified locally to **low hundreds of active pursuits**. That is an operating range, not a product
limit: nothing changes meaning above it, and there is no cap in the ranking. The hosted envelope has
not been measured and must not be inferred from local timings.
