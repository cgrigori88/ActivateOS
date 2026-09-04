#!/usr/bin/env bash
# Recreate and push the PursuitOS milestone backup tags (2026-09-04).
#
# WHY THIS EXISTS. The repository preservation pass created these annotated tags
# locally, but `git push` of tag refs was rejected by the agent-proxy network
# policy with HTTP 403 — on `--tags`, on a single tag, and on protocol v1 —
# while branch pushes to the same repository succeeded throughout. The commits
# are durable regardless (every milestone is reachable from three independent
# remote branches), but the immutable tags are not.
#
# Run this from any clone with normal GitHub credentials:
#     bash audit/restore-backup-tags-2026-09-04.sh
#
# Idempotent: an existing tag is reported and skipped, never replaced.
set -u

tag() { # name sha purpose status
  local n="backup/2026-09-04/$1"
  if git rev-parse -q --verify "refs/tags/$n" >/dev/null 2>&1; then
    echo "  exists, skipping: $n"; return
  fi
  git tag -a "$n" "$2" -m "PursuitOS milestone backup — $1

full SHA : $2
purpose  : $3
date     : 2026-09-04
status   : $4

Immutable point-in-time reference; branches may move, this must not."
  echo "  created: $n -> $2"
}

tag ui-wave-2  c34a16a93bfd0297ccc46a7843683bb5dced0e39 "UI Wave 2 — core rooms read as one operating system" "NON-DEPLOYED (superseded)"
tag ui-wave-3  821da7949781bd7bb895db845977307f45169080 "UI Wave 3 — Goals, Motions, Pipeline as one operating model" "NON-DEPLOYED (superseded)"
tag ui-wave-4  fcee418928a5d4e1e4b026836f967b4f4ed9e120 "UI Wave 4 — execution, automation and human authority as one system" "NON-DEPLOYED (superseded)"
tag ui-wave-5  40b576510b60b5824b2861e5ecff2875b4cdb537 "UI Wave 5 — evidence, confidence and learning as one chain" "NON-DEPLOYED (superseded)"
tag ui-wave-6  c7580ff31a69f7ba57729b2d40a1c10e247e6f0f "UI Wave 6 — whole-product reconciliation, release candidate (NO-GO)" "NON-DEPLOYED (NO-GO)"
tag ui-wave-6b 7f4347e96e5f94ade8f8ead2ec2fcc902273c92b "Wave 6B — release blocker remediation; 5 fatal verifiers to 0" "NON-DEPLOYED (superseded)"
tag ui-wave-6c 5763af63fe10e9b166ad6b378acbf087931ddb76 "Wave 6C — canonical demo world and readability integrity" "NON-DEPLOYED (superseded)"
tag ui-wave-6d 97e975f0d9895c54bfc49cdcc24924d6ac58e796 "Wave 6D — deterministic canonical manifest; final release candidate" "DEPLOYED to demo.pursuitos.io"
tag tds-live-demo 97e975f0d9895c54bfc49cdcc24924d6ac58e796 "TD SYNNEX Friday live demo — certified synthetic operator-controlled walkthrough; NOT tenant-isolation certified" "DEPLOYED (live 2026-09-04)"
tag tds-certification 7d81c2b058fc28108fd0cfc8d70e7492609e29ec "Archived certification note + repository recovery manifest" "NON-DEPLOYED (archival only, never merge)"

echo
echo "pushing tags to origin..."
git push origin --tags
