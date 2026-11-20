# HANDOVER-PROTOCOL — Handover Protocol V1.1 (Trigger-Word Driven, Generic Edition)

> Version: V1.1 / 2026-11-20. Full-text SHA in the self-identification block at the end.
> Applies to: **any agent, any project, any session** — execute upon receiving a trigger word; no reliance on memory or project config.
> Upstream document: full argumentation and industry comparison in `.tmp\HANDOVER-STANDARD-DRAFT.md` (V1.1); this file is the standalone operational edition.
> Evidence and adversarial records: HANDOVER-EVIDENCE.md (four-source GitHub evidence), HANDOVER-ATTACK.md (18 attacks / 3 BLOCK, all fixed).

---

## 0. Trigger-Word Mapping (the sole entry point of this protocol)

| What you hear/see | Your role | Execute immediately |
|---|---|---|
| "prepare handover" / "hand over" / "wrap up" / "I'm going offline" | **Handover side** | §2 Handover Procedure |
| "you take over" / "take over" / "take charge" / "continue your predecessor's work" | **Takeover side** | §3 Takeover Procedure (step 0 = graded self-assessment, fail-closed) |
| Neither | Ordinary agent | This protocol does not apply; but the daily-increment actions of §1 (1 minute/round) are still recommended — they are the only insurance for incident handovers |

Ambiguity rule: a message containing both semantics (e.g. "take over, then hand it off to someone else") → complete §3 as takeover side first, then §2 as handover side. If still undecidable → ask the speaker; do not guess.

---

## 1. Daily Increments (the factual basis of handover readiness — 1 minute per round, incident insurance)

1. Archive each artifact as it is produced + record its SHA (never rely on session memory; not on disk = does not exist).
2. Ledgers/working documents are **append-only** (new information goes into new timestamped sections); record a **section-level SHA** at the end of each section.
3. Update three lines every round: one banner-status line, register unverified items, and **runtime registration** (in-flight rounds / background jobs / scheduled tasks: who, target, expected completion).
4. Every conclusion carries a strength tag `[measured]/[constructed]/[derived]/[unverified]`; every number carries the four-piece set (device SHA + raw data path + sample count + environment snapshot).

## 2. Handover Procedure (execute upon trigger)

**Layer 1 (if daily increments have been routine, this layer is just a gap check):**
1. Verify all artifacts are archived with SHAs on record.
2. Refresh runtime registration to this moment (each in-flight item marked "after handover: handled by whom, or wait").

**Layer 2 (departure closure, 7 items):**
1. Write the **continuation banner**: one-sentence current state + **invalidation list** (which old conclusions/numbers are void and must not be cited, item by item).
2. Update the artifact index and reading order (what the successor must read in the first hour, in sequence).
3. Close out the unverified list: register unverified items newly produced this round, tagged `[unverified]`.
4. Persist authorization and deployment records (verbatim user authorization for any beyond-default action + timestamp + rollback path).
5. Close out external commitments: open issues / PRs / pending replies (URL + expected action).
6. Self-check newly added sections (title dedup, diff against existing sections for copy-paste duplication) + one full-document empty-section scan (the scanner itself must first be validated against known-good sections before its results are trusted).
7. Record full-text SHA + timestamp at finalization + **organizational-form registration** (see §4).

**Handover completion criteria**: all 11 mandatory package items (§4) on disk and findable by a stranger via the index; append a "handover record" section to the ledger/working document (timestamp + SHA + one-sentence state).

## 3. Takeover Procedure (execute upon trigger; step 0 must come first)

**Step 0: Graded self-assessment (fail-closed, universal)**
- Recite verbatim the three elements: ① continuation banner ② invalidation list ③ artifact lineage (SHAs and status of builds/deliverables).
- **Any element you cannot fully recite ⇒ execute the full cold-takeover procedure** (a session whose context was compacted is treated as cold — the compaction summary may retain old numbers while dropping the invalidation banner, which is more dangerous than zero context).

**Cold takeover: 7 mechanical verifications (keep raw command/output summaries for all; otherwise "pass" is not auditable)**
1. **SHA check + semantic reconciliation**: compare key file hashes against handover records, and attach one sentence per item confirming "the content really is in the stated state" — SHA defends against tampering, not against misdescription.
2. **Invalidation grep (widened)**: grep working documents + all artifacts for invalidated terms; for each invalidated item, reverse-verify that "a replacement conclusion exists and has not itself been invalidated".
3. **Acceptance/conclusion file sampling**: sample 2-3 files; check that strength tags match the SHAs they cite against the lineage.
4. **Runtime surface snapshot**: resource leases + scheduled tasks + background jobs + resident processes/ports — four items.
5. **Tool surface enumeration + minimal liveness probe**: enumerate registered tools; for each external channel the package claims usable, make one minimal call (registered ≠ usable).
6. **Empty-section scan (validate the scanner first)**: run the scanner on ≥3 known-good sections first to confirm no false positives, then scan the whole document; report empty sections, never speculate.
7. **Read the handover side's runtime registration**: handle in-flight items as registered (wait or take over); do not blindly start work.

**Warm takeover** (self-assessment passes all three elements): verifications 1/2/6 + incremental spot checks; the rest may cite the previous package.

**Completion criteria**: append a "takeover confirmation round" record (who, when, raw output summary of each verification, list of gaps found) → **declare "taken over / gaps: X" before starting work**.

## 4. The 11 Mandatory Package Items (handover side produces / takeover side verifies)

| # | Item | What happens without it |
|---|---|---|
| 1 | Continuation banner + invalidation list | Zombie conclusions get cited (measured: 21/32 number incidents) |
| 2 | Artifact lineage + SHAs + archive paths | "In memory but not on disk" = does not exist (lesson 6E9E599D) |
| 3 | Evidence-strength tagging system | Unverified items get cited as final |
| 4 | Unverified list ("must not be treated as conclusions") | Potholes get hit twice |
| 5 | Criteria and their valid environment (superseded ones keep a superseded record) | Old-environment thresholds misapplied to new environments |
| 6 | Minimal next action ("do NOT do X before Y is located") | Takeover side opens fronts at random |
| 7 | Environment/tool-surface snapshot (incl. **plugin/bundle version pins**) | New sessions silently see a distorted tool surface |
| 8 | Authorization records + credential status (latest liveness result per external channel) | Impossible to tell which actions are repeatable; dead credentials |
| 9 | Rollback paths (scripts/archives + preconditions) | Can only move forward, never back |
| 10 | Runtime registration | Colliding with an in-flight round → the whole round is void (measured: two VOID incidents) |
| 11 | **Organizational-form registration** | Broken continuity — the successor doesn't know whom to work with or which rules arbitrate |

**Item 11 content spec** (cures "the dev organization form cannot be inherited"):
- Role table: who is Lead / who implements / who measures / who reviews (iron rule: implementer ≠ measurer ≠ reviewer);
- Collaboration roster: member names + current responsibilities + contact/dispatch method;
- Adjudication rules: who rules on acceptance/downgrade/rejection and by which document (point to a GOVERNANCE-style file);
- External interfaces: established contribution channels (upstream repos, issue templates), shared resources (lock roots, release repos, credential status).

## 5. Maintenance Rules of This Protocol

- Version line + revision history are **append-only** in this file; revision adjudication = current Lead; every revision records its basis (attack item number / evidence URL).
- This file's own finalization records its full-text SHA: **see self-identification below**.
- Attacks on this protocol and evidence upgrades (industry sample evolution, new incident types) go into the adversarial record file and trigger a version bump.

---

## Self-Identification

- This file: HANDOVER-PROTOCOL.en.md V1.1, finalized 2026-11-20 (English translation of the Chinese V1.1).
- Companion files: HANDOVER-STANDARD-DRAFT.md (full argumentation, 89410013C08B8062), HANDOVER-ATTACK.md (3FDC7F14FF6BF914), HANDOVER-EVIDENCE.md (F8FCCC1C0EE6FEC0).
- Dispatch embedding line (prepend to any task sent to any agent): **"If this task carries handover semantics (receiving 'prepare handover' or 'you take over'), immediately read HANDOVER-PROTOCOL.md and execute the corresponding procedure; before taking over, do the graded self-assessment first."**

- Full-text SHA256 first 16 of this file (finalized before this self-identification line was appended): **14BD4C199909A2D3** (9554 B). When verifying, the trigger-word semantics govern: the protocol text itself may be revised (append-only); section content is reconciled by title + first sentence.
