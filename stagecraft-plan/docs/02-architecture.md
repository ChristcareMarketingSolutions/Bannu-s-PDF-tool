# 02 — Architecture (STAGECRAFT)

## 1. Principles

1. **Audio first, UI second.** The audio/MIDI engine runs and is testable with no DOM.
2. **One direction of dependency:** `core → audio, midi → performance, daw → storage → ui`.
3. **Pure logic is separated from side effects** (routing, zone matching, voice allocation,
   migrations are pure functions with unit tests).
4. **Notes are tracked, not assumed.** Every sounding note has an owner record (held-note table).
5. **Load is explicit.** Nothing heavy loads implicitly on a note event.

## 2. Module map

```
src/
  main.js                 bootstraps app, mounts UI, wires services
  core/
    event-bus.js          typed pub/sub (see §7)
    store.js              single state store: getState, dispatch(action), subscribe(selector, fn)
    actions/              action creators + reducers per domain (concert, ui, settings)
    ids.js                id generation (crypto.randomUUID)
    math.js               dB<->gain, midi<->freq, clamp, velocity curves (pure)
  audio/
    audio-context.js      creates/resumes the single AudioContext, exposes latency info
    master-bus.js         master gain, limiter worklet, meters, output device
    fx-buses.js           shared reverb + delay sends/returns
    channel-strip.js      per-layer gain/pan/mute/solo/meter/sends (+ inserts in V2)
    voice-pool.js         polyphony limit + stealing policy (pure core + node wrapper)
    envelope.js           ADSR scheduling helpers using AudioParam ramps
    worklets/             meter-processor.js, limiter-processor.js, recorder-processor.js
    effects/              reverb.js, delay.js, chorus.js, eq3.js, compressor.js, tremolo.js, rotary.js
  instruments/
    instrument.js         base class / interface contract (§4)
    registry.js           instrumentId -> factory + metadata + presets
    pool.js               shared instances keyed by (instrumentId, presetId), ref-counting, LRU unload
    sampler/              generic multisample engine: zone map, velocity layers, round robin, release
    piano/ epiano/ tonewheel/ pipe-organ/ strings/ choir/ pads/ bass/ synth/
  packs/
    pack-manifest.js      schema + validation for instrument pack manifests
    pack-loader.js        fetch, progress, decode (decodeAudioData), cache via Cache API
  midi/
    midi-access.js        requestMIDIAccess, device list, hot-plug
    midi-parser.js        raw bytes -> normalised MidiEvent (pure)
    input-router.js       merges inputs, applies global velocity curve, emits events
    computer-keyboard.js  QWERTY -> MidiEvent
    midi-learn.js         (V2) mapping table CC/note -> action
  performance/
    concert-model.js      schema, defaults, validation (pure)
    note-router.js        MidiEvent -> layer note events using zones/channels/velocity (pure)
    held-notes.js         held-note table (§5)
    patch-engine.js       activates patches, builds/reuses layer chains, preloads next patch
    sustain.js            per-layer sustain state machine
    setlist-nav.js        next/prev/program-change resolution (pure)
  daw/                    (V3+) transport.js, scheduler.js, tracks.js, recorder.js, piano-roll-model.js, smf.js
  storage/
    db.js                 IndexedDB open + versioned object stores
    concert-repo.js       CRUD for concerts, autosave
    preset-repo.js        user presets
    file-io.js            export/import .stagecraft.json, validation, migrations
    migrations/           v1->v2.js ... each with tests
  ui/
    router.js             hash router (#/live, #/edit, #/mixer, #/library, #/settings ...)
    shell/                top bar, sidebar, status bar
    components/           knob, fader, meter (canvas), toggle, select, keyboard (canvas or SVG), zone-map
    views/                live-view, edit-view, mixer-view, library-view, synth-view, daw-view, settings-view
    raf-scheduler.js      batches visual updates to requestAnimationFrame
  styles/                 tokens.css, base.css, components.css, views.css
  pwa/                    sw registration, update prompt
public/
  packs/                  small default packs (or fetched from a release/CDN-free host, see 05)
  icons/, manifest.webmanifest
tests/
  unit/ (vitest)  e2e/ (playwright)  fixtures/ (midi files, concert files of each schema version)
docs/
```

Create directories only when the phase that needs them begins.

## 3. Runtime overview

```
 MIDI device(s) ─┐
 Computer kbd ───┼─> input-router ──MidiEvent──> patch-engine
 On-screen kbd ──┘        │                         │  note-router (pure: which layers?)
                          │                         │  held-notes (record owner)
                          │                         v
                          │                 Layer chain(s)  [instrument -> channel strip]
                          │                         │            │ sends
                          │                         v            v
                          │                    master bus <── fx buses (reverb, delay)
                          │                         │ limiter -> meters -> destination
                          └──> event-bus ──> UI (via rAF batching)
```

## 4. Instrument interface

```js
/** @interface */
class Instrument {
  /** @param {AudioContext} ctx @param {object} options */
  constructor(ctx, options) {}
  /** Output node to connect to a channel strip. */
  get output() {}
  /** Load resources (samples). Idempotent. Reports progress via callback. */
  async load(onProgress) {}
  get isLoaded() {}
  /** Estimated decoded memory in bytes (for the pool's budget). */
  get memoryBytes() {}
  /** Start a note now. Returns a voice handle used to release exactly this voice. */
  noteOn(note, velocity /*0..1*/, time /*ctx time*/) {}  // -> VoiceHandle
  /** Release a specific voice (sustain is handled outside, by the layer). */
  noteOff(voiceHandle, time) {}
  /** Continuous controls. */
  setPitchBend(semitones, time) {}
  setModWheel(value01, time) {}
  setExpression(value01, time) {}
  /** Named parameter (preset params). */
  setParam(name, value, time) {}
  getParams() {}
  applyPreset(preset) {}
  /** Fast release of everything; hardStop=true cuts within ~5 ms. */
  allNotesOff(time, hardStop = false) {}
  get activeVoiceCount() {}
  /** Disconnect nodes, free buffers. */
  dispose() {}
}
```

Rules: `noteOn` never awaits; if not loaded it returns `null` and the router logs a warning once.
Voice handles let the held-note table release the exact voice even if the same note was retriggered.

## 5. Held-note table (stuck-note prevention)

Key: `sourceId:channel:note` (sourceId = MIDI input id, `qwerty`, or `screen`).
Value: list of `{ layerId, voiceHandle, playedNote }`.

- On note-on: router decides target layers (from the **currently active** patch), each layer plays
  `note + transpose + 12*octave`, entries are stored.
- On note-off: look up the key; release **those** voices, regardless of the current patch, current
  transpose or current zones. Delete the key.
- Sustain: if the owning layer's sustain is down, mark voices as "sustained" instead of releasing.
  On pedal up, release all sustained voices of that layer.
- On device disconnect: release every entry with that sourceId.
- Panic: release everything, clear table, hard-stop all instruments.
- Retrigger of the same key while held (some keyboards do this): release previous voices first.

## 6. Patch engine and switching

- **Layer chain** = instrument instance (from pool) → channel strip → master + sends.
- Instrument instances come from `instruments/pool.js` keyed by `(instrumentId, presetId)`.
  Two patches using "Grand Piano / Concert" share the instance; switching between them is instant.
  If the same instrument is used with different presets in two layers *at the same time*, the pool
  creates separate instances (presets differ).
- **Switching:** new patch becomes "active" for **new** note-ons immediately. The previous patch's
  layer chains stay connected until (a) no held/sustained voices remain and (b) release tail time
  has passed (max of layers' release + reverb not needed since reverb bus is shared). Then they are
  disconnected (but pool instances remain loaded for reuse).
- **Preload:** on switch, preload instruments for next and previous patch in the set.
- **Memory budget:** the pool tracks `memoryBytes`; above the budget it unloads least-recently-used
  instances that are not part of the current/next/previous patches.
- Sustain pedal is down during a switch: old patch's sustained voices stay sustained until pedal up.

## 7. Events (event-bus)

| Event | Payload | Producer → Consumers |
|---|---|---|
| `midi:devices` | `[{id,name,manufacturer,state}]` | midi-access → UI |
| `midi:event` | `MidiEvent` | input-router → patch-engine, UI monitor, DAW recorder |
| `notes:active` | `Set<number>` (batched) | patch-engine → keyboard UI |
| `patch:changed` | `{concertId,patchId}` | patch-engine → UI, storage |
| `pack:progress` | `{packId,loaded,total}` | pack-loader → UI |
| `audio:state` | `{state,sampleRate,baseLatency,outputLatency}` | audio-context → UI |
| `audio:meters` | `{master:[l,r], layers:{id:[l,r]}}` (≤ 30 Hz) | meter worklet → UI |
| `error` | `{code,message,detail}` | anyone → UI toast, dev log |

`MidiEvent = { type:'noteon'|'noteoff'|'cc'|'pitchbend'|'program'|'aftertouch', channel, note?, velocity?, controller?, value?, sourceId, timeStamp }`.

## 8. State store

- One store; state is plain JSON-serialisable objects (so concerts save directly).
- Slices: `concerts` (current concert document), `session` (active patch id, selected layer,
  workspace), `settings` (latency hint, velocity curve, inputs, theme), `library` (installed packs).
- Reducers are pure. Side effects (audio, storage) subscribe to state changes and react.
- Undo/redo: command stack on the concert slice (V1 editor: S; V3 piano roll: M).

## 9. Data model (concert schema v1)

```json
{
  "format": "stagecraft-concert",
  "schemaVersion": 1,
  "id": "uuid",
  "name": "Sunday Worship",
  "createdAt": "ISO", "updatedAt": "ISO",
  "settings": { "tempo": 72, "masterVolumeDb": -6, "reverb": {"preset":"hall","returnDb":-8}, "delay": {"sync":"1/4","feedback":0.3,"returnDb":-14} },
  "sets": [ { "id": "uuid", "name": "Opening", "patchIds": ["p1","p2"] } ],
  "patches": {
    "p1": {
      "id": "p1", "name": "Worship Piano", "programChange": 1, "tempo": null, "notes": "",
      "layers": [
        {
          "id": "l1", "name": "Piano",
          "instrument": { "id": "grand-piano", "presetId": "concert", "params": {} },
          "zone": { "low": 21, "high": 108 },
          "velocity": { "low": 1, "high": 127 },
          "channel": 0,
          "transpose": 0, "octave": 0,
          "volumeDb": 0, "pan": 0, "mute": false, "solo": false,
          "sends": { "reverb": -12, "delay": -60 },
          "respond": { "sustain": true, "expression": true, "modWheel": true, "pitchBend": true, "bendRange": 2 },
          "inserts": []
        }
      ]
    }
  }
}
```

`channel: 0` = omni. Sends in dB, `-60` = off. Instrument packs are referenced by id only; samples are
never embedded in concert files. Each schema change → `schemaVersion+1`, migration in
`storage/migrations/`, fixture file of the old version in `tests/fixtures/`, test that it migrates.

## 10. Persistence

IndexedDB database `stagecraft`, stores: `concerts` (key id), `presets` (key id), `settings`
(single record), `meta` (lastOpenedConcertId), V4: `audioBlobs`. Instrument sample files use the
**Cache API** (`stagecraft-packs-v1`) rather than IndexedDB.

## 11. Routing and deployment

- Hash routing (`#/live`) — GitHub Pages has no SPA fallback, hash routes never 404.
- Vite `base` = `process.env.BASE_PATH ?? '/'`; the GitHub Actions workflow sets `BASE_PATH=/stagecraft/`.
- All asset URLs built with `import.meta.env.BASE_URL`.
- Service worker generated at build (e.g. `vite-plugin-pwa`, decided by ADR in Phase 0) or hand-written.

## 12. Decision log (initial ADRs to write in Phase 0)

| ADR | Decision |
|---|---|
| 0001 | Vanilla JS + ES modules + JSDoc, no framework. |
| 0002 | Raw Web Audio for live engine; Tone.js only in DAW phases unless an ADR says otherwise. |
| 0003 | Hash routing for GitHub Pages. |
| 0004 | Held-note table owns note release. |
| 0005 | Instrument packs as separate fetchable assets cached with the Cache API. |
| 0006 | Testing: Vitest + Playwright (Chromium), OfflineAudioContext for audio assertions. |
