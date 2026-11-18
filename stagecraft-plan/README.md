# STAGECRAFT — Development Plan Pack for Claude

This folder is a complete, execution-ready plan for building **STAGECRAFT**, a browser-based
live-performance keyboard workstation (MainStage-style) with a later mini-DAW.

It is written to be handed to **Claude Code** and executed phase by phase. It is structured the
way an Employer's Requirements document is structured on an infrastructure contract: defined
scope, numbered requirements, milestones (phases), acceptance tests, a definition of done,
change control, and a risk register. Claude is the "contractor"; you are the "engineer" who
certifies each milestone.

## What is in the pack

| File | Purpose | Who reads it |
|---|---|---|
| `CLAUDE.md` | Standing rules Claude must obey in every session. Copy to the **root** of the new repo — Claude Code loads it automatically. | Claude (every session) |
| `docs/01-product-spec.md` | Scope, users, numbered functional and non-functional requirements, exclusions, glossary. | You + Claude |
| `docs/02-architecture.md` | Module design, data model, audio graph, MIDI routing, state, events, decisions. | Claude |
| `docs/03-roadmap.md` | Phases 0–9: tasks, files, acceptance tests, exit gates. **The work programme.** | You + Claude |
| `docs/04-audio-midi-engineering.md` | Low-level audio/MIDI rules: latency, voices, sustain, patch switching, memory. | Claude |
| `docs/05-instruments-and-samples.md` | How each instrument is built, sample formats, memory budget, licensing. | You + Claude |
| `docs/06-testing-qa.md` | Test strategy, automated tests, manual hardware checklist, latency measurement. | You + Claude |
| `docs/07-prompts.md` | Copy-paste prompts for each phase, reviews, bug fixes and resuming work. | You |
| `docs/08-risk-register.md` | Technical, licensing and schedule risks with mitigations. | You + Claude |
| `docs/templates/*` | Development log, phase completion certificate, ADR (decision record). | Claude |

## How to use it (step by step)

1. **Create a new, separate GitHub repository** named `stagecraft`. (Do not build it inside the
   PDF-tool repository; they are unrelated products with different build pipelines.)
2. Copy the contents of this folder into the new repo:
   - `CLAUDE.md` → repo root
   - `docs/` → repo `docs/`
   - this `README.md` → `docs/00-plan-overview.md` (Claude will write the real README in Phase 0)
3. Open a Claude Code session on the new repo.
4. Paste **Prompt 0 (Kickoff)** from `docs/07-prompts.md`. Claude will do Phase 0 only.
5. Review what Claude delivers against the **Exit Gate** for that phase in `docs/03-roadmap.md`.
   Run the manual checks yourself (sound, MIDI keyboard) — Claude in a cloud container cannot hear
   audio or see your MIDI keyboard.
6. When the gate passes, sign it off (Prompt "Phase sign-off") and start the next phase prompt.
7. Repeat. Never let Claude run two phases in one go.

## Key corrections to the original draft plan

The original blueprint was good in direction. These changes were made so it is buildable:

1. **V1 release moved earlier.** The draft only "released" at Phase 9. Here a public V1 release
   gate sits after Phase 5 (live workstation complete). The DAW work comes after a stable live tool.
2. **Basic reverb pulled into V1.** A piano or pad with no reverb is not usable live; a single
   shared reverb bus and delay bus come in Phase 4, the full mixer in Phase 6.
3. **Memory budget made explicit.** Compressed sample files expand roughly 10× when decoded in the
   browser (32-bit float PCM). A 60 MB download can need 600 MB+ of RAM. Budgets are now set per
   instrument (see `05-instruments-and-samples.md`).
4. **Latency expectations made realistic.** Browsers cannot use ASIO on Windows. Expect roughly
   20–50 ms end-to-end on a typical Windows laptop; we measure it rather than promise a figure.
5. **Held-note routing fixed by design.** Notes are released through a held-note table, not by
   "current patch", so patch switches and transpose changes can never leave stuck notes.
6. **Requirement IDs added** (e.g. `LIVE-012`) so every test and every commit traces back to a
   requirement — the same traceability you would expect in a contract compliance matrix.
7. **Licensing made a deliverable.** Every sample/impulse response must be logged in
   `ASSET-LICENSES.md` with source and licence before it is committed.
8. **Hash-based routing** for GitHub Pages so refreshing a nested view never returns a 404.
9. **The stray "SONIQSTUDIO" title** in the draft is removed — the product name is STAGECRAFT throughout.

## Realistic programme

| Milestone | Phases | Indicative effort (focused Claude sessions) |
|---|---|---|
| M0 Foundation | 0 | 1–2 |
| M1 Playable synth + keyboard + MIDI | 1–2 | 3–5 |
| M2 Real instruments | 3 | 3–6 (mostly sample sourcing) |
| M3 Live performance workstation | 4 | 4–6 |
| **M4 V1 public release** | 5 | 2–3 |
| M5 Mixer, effects, synth designer (V2) | 6–7 | 5–8 |
| M6 MIDI DAW (V3) | 8 | 5–8 |
| M7 Audio DAW (V4) | 9 | 5–8 |

Effort depends heavily on how quickly you can test on real hardware and give feedback.
