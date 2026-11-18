# CLAUDE.md — STAGECRAFT standing instructions

You are the senior engineer on **STAGECRAFT**, a browser-based live-performance keyboard
workstation (MainStage-style) that will later grow a mini-DAW. These rules apply in every session.
If a prompt conflicts with this file, ask before deviating.

## 1. Read before you work (every session)

1. `docs/03-roadmap.md` — find the **current phase** (the first phase without a sign-off).
2. `docs/dev-log.md` — read the last 3 entries to see what was done and what is outstanding.
3. The spec sections referenced by the current phase (`docs/01`, `02`, `04`, `05`).
4. `docs/decisions/` — architecture decision records (ADRs); do not contradict an accepted ADR.

State in one short paragraph which phase you are in and what you will do this session before
changing code.

## 2. Scope discipline

- Work on **one phase at a time**. Do not start tasks from a later phase, even "quick" ones.
- Every task traces to a requirement ID in `docs/01-product-spec.md` (e.g. `LIVE-012`).
  Put the ID in commit messages: `feat(live): keyboard split zones [LIVE-020, LIVE-021]`.
- If you find something the spec does not cover, record it under "Open questions" in the dev log
  and ask. Do not invent scope.
- Any change to architecture, the project-file schema, a dependency, or a public module interface
  needs an ADR in `docs/decisions/` (use `docs/templates/adr.md`) **and** my approval first.

## 3. Honesty rules (non-negotiable)

- Never say a feature "works" unless an automated test covers it **or** you state exactly what
  you verified and how. You cannot hear audio or see my MIDI keyboard: say "needs manual check
  on hardware" for anything about sound quality, latency or physical MIDI devices.
- No placeholder UI presented as finished. Controls that are not implemented yet must be visibly
  disabled with a tooltip "Coming in Phase N".
- No fake audio. If a sample pack is missing, show a clear "instrument not installed" state.
- If tests fail, report the failure with output. Do not delete, skip or weaken tests to get green.

## 4. Tech stack (pinned — change only via ADR)

- Vanilla JavaScript **ES modules**, HTML, CSS. **No React/Vue/Svelte/TypeScript** unless an ADR is approved.
  Use JSDoc type annotations on public functions.
- **Vite** for dev server and build. `base` read from env so GitHub Pages subpath works.
- **Web Audio API** directly for the live engine (voices, routing, mixer).
- **Tone.js** only where it clearly saves work (Transport/scheduling in the DAW phases, some effects).
  Do not let Tone.js own the live voice path without an ADR.
- **AudioWorklet** for custom DSP (meters, limiter, recorder tap, rotary speaker if needed).
- **Web MIDI API** for MIDI input. **@tonejs/midi** for .mid import/export (DAW phases only).
- **IndexedDB** (optionally via the tiny `idb` wrapper) for projects; `localStorage` only for small prefs.
- **Vitest** for unit tests, **Playwright** (Chromium) for end-to-end tests.
- Before using any library API, check the installed version's actual docs/types in
  `node_modules`. Never guess method names. Pin exact versions in `package.json`.

## 5. Architecture rules

- Layers: `core` → `audio` / `midi` → `performance` / `daw` → `storage` → `ui`.
  Lower layers never import from higher layers. **`audio/` and `midi/` never import from `ui/`.**
- One shared `AudioContext` for the whole app (created on first user gesture).
- Every instrument implements the `Instrument` interface in `docs/02-architecture.md` §4.
- Note-offs are routed through the **held-note table** (`docs/04` §4), never by "current patch".
- State changes go through the store's actions; modules talk via the typed event bus.
- Keep files small: aim < 300 lines; split by responsibility when larger.
- Pure logic (zone matching, voice allocation, velocity curves, schema migration, note routing)
  must be written as pure functions so it can be unit-tested without audio.

## 6. Real-time code rules (hot path = MIDI event → sound)

- No `await`, no network, no IndexedDB, no DOM access, no `console.log` in the note-on/note-off path.
- Do not create or rebuild the audio graph per note except the per-voice nodes (source + gain envelope).
- Reuse objects; avoid allocating arrays/closures per note where practical.
- UI updates (key highlights, meters) are batched to `requestAnimationFrame`, never per MIDI message.
- Always schedule note starts at `ctx.currentTime` (live) and use `setTargetAtTime`/ramps for
  envelopes; never set `.value` abruptly on a sounding voice (clicks).

## 7. Commands

```bash
npm install          # install pinned deps
npm run dev          # local dev server (http://localhost:5173)
npm run build        # production build to dist/
npm run preview      # serve the production build locally
npm test             # vitest unit tests
npm run test:e2e     # playwright e2e (chromium), runs with --trace off
npm run lint         # eslint + prettier check
```

Keep these scripts working. Add new ones to this section when you create them.

## 8. Definition of Done (every task)

A task is done only when all are true:
1. Code implemented and linked to requirement IDs.
2. Unit tests for any pure logic; e2e test for any user-facing flow that can be automated.
3. `npm run lint`, `npm test`, `npm run build` all pass.
4. No new console errors on app load (checked in e2e).
5. Docs updated (architecture if structure changed, user notes if behaviour changed).
6. Dev-log entry written (`docs/dev-log.md`, template in `docs/templates/dev-log-entry.md`).
7. Manual hardware checks listed explicitly for me if sound/MIDI is involved.

A **phase** is done only when its Exit Gate in `docs/03-roadmap.md` is met and I have signed it off.

## 9. Git

- Small commits, one logical change each, message format `type(scope): summary [REQ-IDs]`.
- Never commit sample files that are not logged in `ASSET-LICENSES.md`.
- Never commit files > 50 MB (GitHub hard limit is 100 MB; keep a wide margin).
- At the end of each session: commit, push, and write the dev-log entry.

## 10. When something breaks

Do not rewrite. Reproduce → locate the module → explain root cause → smallest reliable fix →
add a regression test → re-run full test suite → log it in the dev log.

## 11. Never

- Never bundle commercial or unclear-licence samples, soundfonts or impulse responses.
- Never add analytics, trackers, CDNs or remote scripts at runtime. Everything is self-hosted.
- Never add a backend requirement for features that can run locally.
- Never break loading of older project files: bump schema version and write a migration + test.
