# 01 — Product Specification (STAGECRAFT)

Status: Baseline v1.0 · Changes to this document follow the Change Control procedure in §9.

## 1. Vision

A musician opens a web page, connects a MIDI keyboard, picks "Worship Piano + Pad", and plays a
Sunday service with reliable, responsive sound — switching patches between songs without stuck
notes, dropouts or silence. Later, the same tool records MIDI and audio and arranges simple songs.

Inspired by the *concepts* of Apple MainStage, Ableton Live, Logic Pro, Kontakt and Arturia Analog Lab.
No code, assets, names, artwork or UI designs from those products are copied.

## 2. Users and use cases

| User | Primary use |
|---|---|
| Church / worship keyboardist (primary) | Live services: piano, pads, strings, organ; layered patches; setlist per service. |
| Gigging keyboardist | Splits (bass left hand / piano right), fast patch changes by MIDI foot switch. |
| Home musician / learner | Play with good sounds without buying software; record ideas. |

Key scenarios (used as end-to-end acceptance scenarios):
- **S1 Sunday service:** Load concert "Sunday Worship", 8 patches in 3 sets, play through all with a
  MIDI keyboard and sustain pedal, change patches mid-song while holding chords.
- **S2 Split gig:** Bass on C1–B2, piano C3–C8, pad layered C3–C8 at 30 %. Program change from keyboard.
- **S3 Offline church:** Venue has no Wi-Fi. App and installed instruments still load and play.
- **S4 Idea capture (V3):** Record 16 bars of MIDI to a click, quantise, play back, export .mid.

## 3. Platform

- **Primary:** Desktop Chrome and Edge (latest two versions), Windows 10/11 and macOS.
- **Secondary (best effort):** Firefox desktop (Web MIDI requires a site-permission add-on prompt).
- **Not supported for MIDI:** Safari (no Web MIDI). The app must still load and play from the
  on-screen/computer keyboard and show a clear notice.
- Hosting: static site on GitHub Pages under HTTPS (required for Web MIDI and AudioWorklet).
- Input: external USB/Bluetooth MIDI keyboards, on-screen keyboard, computer keyboard.

## 4. Release scope

| Release | Contents |
|---|---|
| **V1 Live** | Keyboard + MIDI, 7 core instruments, layers, splits, concerts/sets/patches, sustain, volume/pan, shared reverb & delay, save/restore/import/export, GitHub Pages, offline shell. |
| **V2 Sound** | Full mixer, per-layer insert effects, synth designer, preset browser, MIDI-learn. |
| **V3 MIDI DAW** | Transport, metronome, MIDI tracks, recording, piano roll, quantise, .mid import/export. |
| **V4 Audio DAW** | Audio tracks, microphone/interface recording, timeline editing, WAV export (offline render). |

### Exclusions (explicitly out of scope unless changed by Change Control)
- User accounts, cloud sync, any backend server.
- VST/AU plug-in hosting, ASIO driver access (not possible in browsers).
- Multichannel (> 2 in) audio interface recording guarantees.
- Mobile/tablet optimised performance UI (it should load, but is not tuned).
- Notation/score view, audio time-stretching, pitch correction.
- Bundling of commercial sample libraries.

## 5. Glossary

| Term | Meaning |
|---|---|
| **Concert** | Top-level live document (one per service/gig). Contains sets and patches and global settings. |
| **Set** | Ordered group of patches within a concert (e.g. "Opening", "Worship", "Closing"). |
| **Patch** | One playable sound configuration. Contains one or more layers. |
| **Layer** | One instrument inside a patch, with its own key zone, velocity range, transpose, level, pan, sends, effects. |
| **Zone** | Key range (low note–high note) a layer responds to. Splits = non-overlapping zones; layers = overlapping zones. |
| **Instrument** | A sound engine (sampler, organ model, synth) implementing the common Instrument interface. |
| **Preset** | Saved parameter set for an instrument (e.g. "Bright Grand"). |
| **Instrument pack** | A downloadable set of samples + manifest for a sample-based instrument. |
| **Voice** | One sounding note inside an instrument. |

## 6. Functional requirements

Priority: **M** = must (in its release), **S** = should, **C** = could.

### 6.1 Audio core (AUD)
| ID | Requirement | Pri | Release |
|---|---|---|---|
| AUD-001 | Single shared AudioContext, started on first user gesture, with a visible "Start audio" control if suspended. | M | V1 |
| AUD-002 | Display audio state (running/suspended/error), sample rate, base + output latency. | M | V1 |
| AUD-003 | Master volume (dB) with peak meter (L/R) and clip indicator. | M | V1 |
| AUD-004 | Master safety limiter enabled by default; can be bypassed in Settings. | M | V1 |
| AUD-005 | Polyphony limit per instrument (configurable, default 64 total voices) with voice stealing (oldest released first, then oldest held, never the most recent note). | M | V1 |
| AUD-006 | "Panic" button and keyboard shortcut (Esc) = all notes off + reset controllers on all instruments. | M | V1 |
| AUD-007 | Audio output device selection where the browser supports `AudioContext.setSinkId`. | S | V1 |
| AUD-008 | Configurable latency hint (Interactive / Balanced / Playback) — requires context restart, warned to user. | S | V1 |

### 6.2 Keyboard & MIDI (MIDI)
| ID | Requirement | Pri | Release |
|---|---|---|---|
| MIDI-001 | Request MIDI access; list inputs; select one, several or "All inputs". | M | V1 |
| MIDI-002 | Hot-plug: detect connect/disconnect; on disconnect release all notes from that device. | M | V1 |
| MIDI-003 | Note on/off with velocity; note-on velocity 0 treated as note-off. | M | V1 |
| MIDI-004 | Sustain pedal CC64 (≥64 down), with half-pedal ignored in V1. | M | V1 |
| MIDI-005 | Mod wheel CC1, expression CC11, volume CC7, pitch bend (per-layer bend range, default ±2). | M | V1 |
| MIDI-006 | Program change selects patch by its program number; bank select CC0/32 optional. | M | V1 |
| MIDI-007 | MIDI activity indicator per input; last-message monitor in Settings for troubleshooting. | M | V1 |
| MIDI-008 | Global velocity curve (linear, soft, hard, fixed) + per-layer velocity range. | M | V1 |
| MIDI-009 | MIDI-learn: map any CC/note to actions (next/prev patch, panic, layer volume, master volume). | S | V2 |
| MIDI-010 | On-screen 88-key keyboard: mouse/touch play, velocity by vertical click position, active-note highlight incl. external MIDI. | M | V1 |
| MIDI-011 | Computer keyboard play (two rows, A–K white keys, W/E/T/Y/U black), Z/X octave, C/V velocity, Space = sustain toggle. Disabled while typing in text fields. | M | V1 |
| MIDI-012 | Clear message when Web MIDI is unavailable (browser) or permission denied, with how to fix. | M | V1 |

### 6.3 Instruments (INS)
| ID | Requirement | Pri | Release |
|---|---|---|---|
| INS-001 | Common Instrument interface (see architecture §4) for all engines. | M | V1 |
| INS-002 | Grand Piano (multisampled, ≥ 3 velocity layers, release behaviour, sustain resonance not required). | M | V1 |
| INS-003 | Electric Piano (multisampled or modelled), with tremolo. | M | V1 |
| INS-004 | Tonewheel organ (additive 9-drawbar model, percussion, key-click, rotary slow/fast via mod wheel or CC). | M | V1 |
| INS-005 | Church/pipe organ (stops as presets: Principal 8', Flute 8'+4', Full Organ). | M | V1 |
| INS-006 | Strings ensemble (sampled, slow/fast attack presets). | M | V1 |
| INS-007 | Choir "aah/ooh" (sampled if a properly licensed source exists, otherwise synthesised formant pad, documented). | M | V1 |
| INS-008 | Ambient / worship pads (synthesised, ≥ 6 presets). | M | V1 |
| INS-009 | Synth bass (synthesised). | M | V1 |
| INS-010 | Instrument packs load on demand with progress, are cached for offline use, and can be removed. | M | V1 |
| INS-011 | User can import their own samples (folder of WAV/FLAC + naming convention or mapping dialog). | C | V2 |
| INS-012 | Drum kit (sampled) for DAW use. | S | V3 |

### 6.4 Live performance (LIVE)
| ID | Requirement | Pri | Release |
|---|---|---|---|
| LIVE-001 | Create, rename, duplicate, delete concerts. | M | V1 |
| LIVE-002 | Create, rename, reorder (drag), duplicate, delete sets and patches. | M | V1 |
| LIVE-003 | Patch contains 1–8 layers. | M | V1 |
| LIVE-010 | Per-layer: instrument + preset, volume (dB), pan, mute, transpose (±24), octave (±3), MIDI channel (omni or 1–16), velocity range, sustain/expression/mod/bend response toggles. | M | V1 |
| LIVE-011 | Per-layer reverb and delay send levels. | M | V1 |
| LIVE-020 | Key zones per layer with visual zone map over the keyboard; drag handles for low/high note. | M | V1 |
| LIVE-021 | "Learn zone": press lowest then highest key on MIDI keyboard to set the zone. | S | V1 |
| LIVE-030 | Patch switching by click, arrow keys / PageUp/PageDown, program change, or mapped MIDI control. | M | V1 |
| LIVE-031 | Held notes and sustained notes continue on the old patch after a switch and release normally (no cut-off, no stuck notes). | M | V1 |
| LIVE-032 | Instruments needed by the **current and next** patch are preloaded; instruments shared between patches are not reloaded. | M | V1 |
| LIVE-033 | Patch switch time from command to new patch playable ≤ 50 ms when instruments are already loaded (measured). | M | V1 |
| LIVE-040 | Performance view: large current patch name, next/previous names, set name, master meter, MIDI and CPU/audio status, panic button; readable from 1.5 m. | M | V1 |
| LIVE-041 | Per-patch tempo (for delay sync) and optional notes/lyrics cue text. | S | V1 |
| LIVE-042 | "Performance lock" mode prevents accidental editing during a service. | S | V1 |

### 6.5 Mixer & effects (MIX)
| ID | Requirement | Pri | Release |
|---|---|---|---|
| MIX-001 | Shared reverb bus and delay bus (tempo-syncable) with return levels. | M | V1 |
| MIX-002 | Mixer view: strip per layer of current patch: fader, pan, mute, solo, meter, sends. | M | V2 (basic version in V1 patch editor) |
| MIX-003 | Per-layer insert chain (max 4): EQ (3-band), compressor, chorus, tremolo, filter, rotary, delay. | M | V2 |
| MIX-004 | Master chain: EQ + limiter. | M | V2 |
| MIX-005 | All parameter changes are de-zippered (smoothed) to avoid clicks. | M | V1 |

### 6.6 Synth designer (SYN)
| ID | Requirement | Pri | Release |
|---|---|---|---|
| SYN-001 | 2 oscillators + sub/noise, waveforms sine/saw/square/triangle, detune, unison (≤ 4). | M | V2 |
| SYN-002 | Filter LP/HP/BP 12/24 dB with cutoff, resonance, envelope amount, key tracking. | M | V2 |
| SYN-003 | Amp ADSR, filter ADSR, 1–2 LFOs with destinations (pitch, cutoff, amp, pan). | M | V2 |
| SYN-004 | Mod wheel and velocity routable to cutoff/LFO depth. | M | V2 |
| SYN-005 | Save/export/import user presets (JSON). | M | V2 |

### 6.7 DAW (DAW)
| ID | Requirement | Pri | Release |
|---|---|---|---|
| DAW-001 | Transport: play/stop/record, BPM 30–300, time signature, loop region, count-in, metronome. | M | V3 |
| DAW-002 | MIDI tracks using any patch/instrument; record from live input with sample-accurate timestamps. | M | V3 |
| DAW-003 | Piano roll: draw, select, move, resize, delete, velocity lane, snap/grid, quantise (strength), copy/paste, undo/redo. | M | V3 |
| DAW-004 | Import/export Standard MIDI File (.mid). | M | V3 |
| DAW-010 | Audio tracks: record from input (echo cancellation/noise suppression/AGC off), latency compensation offset. | M | V4 |
| DAW-011 | Clip move/trim/split/fade, track volume/pan/mute/solo. | M | V4 |
| DAW-012 | Export mix to WAV (16/24-bit) via offline rendering. | M | V4 |

### 6.8 Storage & projects (STO)
| ID | Requirement | Pri | Release |
|---|---|---|---|
| STO-001 | Concerts and presets stored in IndexedDB; autosave (debounced 2 s) + manual save (Ctrl+S). | M | V1 |
| STO-002 | Restore last opened concert on reload. | M | V1 |
| STO-003 | Export/import concert as `.stagecraft.json` (versioned schema, validated on import with readable errors). | M | V1 |
| STO-004 | Schema migrations: any older file version opens in the current app. | M | V1 |
| STO-005 | Request persistent storage (`navigator.storage.persist`) and show storage usage. | S | V1 |
| STO-006 | DAW projects saved with audio stored as blobs in IndexedDB; export as zip bundle. | M | V4 |

### 6.9 App shell, deployment, offline (APP)
| ID | Requirement | Pri | Release |
|---|---|---|---|
| APP-001 | Workspaces: Live, Edit (patch editor), Mixer, Library, Synth, DAW, Settings; hash routing (`#/live`). | M | V1 (only implemented ones enabled) |
| APP-002 | Dark professional theme, keyboard-navigable, visible focus states, minimum 4.5:1 text contrast. | M | V1 |
| APP-003 | Deploy to GitHub Pages via GitHub Actions on push to `main`. | M | V1 |
| APP-004 | PWA: installable; service worker caches app shell; instrument packs cached on install. | M | V1 |
| APP-005 | "Update available" prompt — never auto-reload during a performance. | M | V1 |
| APP-006 | No runtime third-party network requests (fonts, scripts, analytics all self-hosted). | M | V1 |

## 7. Non-functional requirements (NFR)

| ID | Requirement | Target / Measure |
|---|---|---|
| NFR-01 | Added software latency (MIDI event received → note scheduled) | ≤ 3 ms median, measured with `performance.now()` instrumentation. |
| NFR-02 | End-to-end latency (key press → sound) | Measured and reported per test machine; target ≤ 30 ms on reference Windows laptop with "Interactive" hint. Not guaranteed. |
| NFR-03 | Polyphony | 64 voices of Grand Piano with sustain held, no audible dropouts on reference machine. |
| NFR-04 | Stuck notes | Zero in the stress test (§06 testing T-STRESS). |
| NFR-05 | Initial load (app shell, no instruments) | < 2 s on broadband, < 1.5 MB JS+CSS gzipped. |
| NFR-06 | Memory | V1 default concert (piano, EP, organ, strings, pad) ≤ 600 MB decoded audio. |
| NFR-07 | Stability | 3-hour soak test playing a MIDI file loop with patch changes every 30 s: no crash, no growth > 10 % in memory after warm-up. |
| NFR-08 | Data safety | No data loss on browser refresh/crash after autosave interval. |
| NFR-09 | Accessibility | All controls reachable by keyboard; ARIA labels on custom controls. |
| NFR-10 | Privacy | No data leaves the device. No telemetry. |

## 8. Acceptance

Each release is accepted when: all **M** requirements for that release are implemented, linked tests
pass, the manual hardware checklist (`06-testing-qa.md`) is signed by the product owner, and the
scenario(s) S1–S4 relevant to the release are performed successfully on real hardware.

## 9. Change control

1. Proposed change is written as a short note in `docs/change-requests.md`: what, why, affected
   requirement IDs, effect on schedule and architecture.
2. Product owner approves/rejects. Approved changes update this spec (bump version) and the roadmap.
3. Claude must not implement unapproved scope.
