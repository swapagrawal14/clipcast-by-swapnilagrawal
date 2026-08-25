# ClipCast — Audiogram Maker

> Turn a podcast or voice clip into a shareable animated video — waveform, captions, cover art —
> ready for Reels, Shorts, TikTok and YouTube. **100% free, no watermark, no sign-up, nothing ever
> leaves your device.**

ClipCast is a complete, production-quality audiogram studio that runs entirely in your browser:
load an audio clip, trim it, style the waveform and captions, and export a finished video (WebM/MP4),
a looping GIF, or PNG snapshots — all rendered locally on your machine.

The free, no-compromise alternative to Headliner / Recast / Wavve (which watermark exports and
charge ~$20/month).

---

## ⚡ Quick start (no build step)

```bash
# either just open the file…
open index.html

# …or serve the folder (recommended — needed for some browsers' file access):
python3 -m http.server 8080
# → http://localhost:8080
```

That's it. No npm install, no build step, no CDN, no backend. Drop the folder on GitHub Pages,
Vercel, Netlify or any static host and it works as-is.

```bash
# run the acceptance suite (optional — needs Node + a one-time browser download):
npm i playwright-core && npx playwright-core install chromium --with-deps
node test/run.mjs
```

---

## 🔒 Privacy is the headline feature

- **Nothing leaves your device.** No uploads, no accounts, no analytics, no telemetry, no CDN calls.
- Audio, images and projects are stored only in your own browser's **IndexedDB / localStorage**.
- Exports are rendered locally by your CPU.
- The page works **fully offline after first load** (all fonts are shipped locally in `fonts/`).
- The only external requests are none. (Verified: zero network activity at runtime.)

## ✨ Features

**Audio engine**
- Load MP3 / WAV / M4A / OGG / AAC / FLAC via drag-drop or file picker; blobs persist in IndexedDB
- One-time `decodeAudioData` + precomputed min/max peaks envelope (1024 buckets, mono-summed) — renders are cheap
- Trim editor with draggable handles on the waveform strip + numeric fields + loop-preview + "trim to playhead" (T)
- Optional BGM track: second audio file, volume, auto-duck (−8 dB under detected voice via an energy-gated curve), loop
- Peak-normalize toggle (−1 dBFS at decode/export time)

**Render engine** (pure function `render(project, tSeconds, ctx)` — identical in preview and export)
- Aspect presets: 1:1 (1080²), 9:16 (1080×1920), 16:9 (1920×1080), 4:5 (1080×1350)
- 6 waveform styles: **bars · filled · mirror line · radial donut · dot matrix · spectrum** — each with bar count, gap, rounded caps, played/unplayed colors, playhead line
- Live energy bounce (bars near the playhead scale with local loudness, smooth-lerped) + optional level meter
- Layout blocks, draggable on the preview with snap guides + margins: waveform · cover art (rounded, shadow, slow Ken Burns zoom, grayscale) · title · subtitle/@handle · progress bar · timer chip · optional watermark line (off by default — we don't watermark)
- 14 backgrounds: solid, 4 curated gradients, paper-grain, grid, dots, chalk, neon-dark, sunset, aurora + custom colors/gradient + uploaded image (cover-fit)
- 6 ready templates: **Podcast Minimal · Hormozi Captions · Neon Rings · Quote Card · Lofi Desk · Breaking News**

**Captions**
- Import plain transcripts (auto-distributed across the trim), or real SRT/VTT parsing (timestamps, multiline cues, indexes, cue settings)
- Display modes: **word-karaoke** (current word highlighted, previous dimmed) · **phrase fade** · **big-word** (1–3 huge words with pop-in + accent color) · none
- 9 embedded local font families (all OFL), size, colors, outline/shadow, ALL-CAPS, max words per line
- Cue editor: start/end fields, split at playhead (snaps to word boundary), merge, nudge ±0.1 s, delete
- Position: top / middle / bottom thirds
- Honest timing model: per-word timing is interpolated evenly inside each cue (documented in the JSON spec)

**Preview / timeline**
- Canvas preview, Space to play, scrub anywhere, drift-corrected `currentTime` sync (±0.15 s threshold)
- Zoom-to-fit, safe-margin overlay, grid overlay

**Export**
- **WebM (VP9)** + **MP4 (H.264)** where supported, 24/30 fps, low/medium/high quality, 50–200% resolution scale, scope = trimmed region
- Deterministic pacing: `canvas.captureStream(0)` + `requestFrame()` stepping (exact frame counts), countdown 3-2-1, live progress + ETA, cancel
- Sample-accurate audio: everything scheduled with `AudioBufferSourceNode.start(when, offset, dur)` on the AudioContext clock, ducked BGM via `setValueCurveAtTime`, `audioBitsPerSecond 192k`
- **WebM Duration metadata patched** (EBML Segment→Info `0x4489` float64 insert/overwrite, sizes fixed) so players don't hang on unknown duration — verified with `ffprobe`
- Muted GIF loop (built-in GIF89a/LZW encoder, 12 fps), PNG frame snapshot, waveform-only thumbnail PNG
- 3-2-1 countdown, live progress + ETA, cancel

**Project & JSON**
- Autosave (debounced, flushed on unload) + multi-project manager (open/duplicate/delete, opened-at-boot)
- Undo/redo (60 steps), dirty indicator
- `.json` project files: download/upload round-trip **everything**, audio and images included as base64 data-URLs
- The exported JSON **is** the AI-authorable **ClipCast spec** (`clipcast: 1`) — see [`AI-AUDIOGRAM-DIRECTOR.md`](AI-AUDIOGRAM-DIRECTOR.md) for the system prompt that turns any LLM into a spec generator
- Tolerant importer: fraction-or-px-or-keyword coordinates, enum validation with warn-and-skip, auto defaults

**UI polish**
- Dark/light themes (dark default), toasts, welcome modal with 3 sample templates + a pleasant 8 s synth demo clip generated in-page (no external files)
- First-run guided tour (6 steps), small-screen notice (<900 px, continue-anyway)
- Keyboard: `Space`, `←/→` (+`Shift` = ±5 s), `S` split cue, `T` trim to playhead, `Ctrl+Z/Y`, `Ctrl+S`, `Ctrl+E`, `Del`
- Accessibility: real focus rings, aria-labels on icon buttons, `prefers-reduced-motion` honored

---

## 📦 Project structure

```
clipcast/
├── index.html              # single-page app shell (no build)
├── css/clipcast.css        # design system, themes, layout
├── js/
│   ├── util.js             # helpers: time/color/DOM/toast (window.AC namespace)
│   ├── assets.js           # IndexedDB blob store, decode + peaks cache, sample synth, fonts
│   ├── waveform.js         # peaks envelope + the 6 style renderers + strip renderer
│   ├── captions.js         # SRT/VTT/plain parsing, karaoke interpolation, cue ops
│   ├── engine.js           # pure render(project, tSeconds, ctx): bg, blocks, captions
│   ├── state.js            # project model, templates, autosave, undo/redo
│   ├── stage.js            # preview canvas, playback (HTMLAudioElement, drift-corrected)
│   ├── timeline.js         # trim handles, numeric fields, captions cue list
│   ├── panels.js           # left panels (templates/blocks/style/background) + inspector
│   ├── exporter.js         # WebM/MP4/GIF/PNG export, WebAudio graph, EBML duration patch
│   ├── jsonio.js           # project ⇄ spec (dataURL round-trip) + tolerant importer
│   ├── tour.js             # welcome modal, guided tour, small-screen notice
│   └── main.js             # boot, top bar, keyboard, drag-drop, debug hooks
├── fonts/                  # 16 local woff2 files — Inter, Montserrat, Oswald, Anton,
│                           # Bebas Neue, Merriweather, Pacifico, Caveat (all OFL-licensed)
├── test/                   # headless acceptance suite (playwright-core + ffmpeg)
│   └── run.mjs             # node test/run.mjs
├── README.md
└── AI-AUDIOGRAM-DIRECTOR.md
```

**Architecture notes**
- One global namespace `window.AC`, one responsibility per module.
- **Times are seconds everywhere** (never 0..1 fractions) — this eliminates a whole class of bugs.
- Coordinates (block positions/sizes) are canvas fractions 0..1 internally; the JSON importer accepts fractions, pixels, or keywords.
- The engine is a pure function — the preview, the contact-sheet tests and every export path render through the same code, so what you see is exactly what you export.

---

## 📋 The ClipCast JSON spec

The `.json` you download is both a full project backup and an authorable spec. Everything is optional
except `clipcast`; the importer fills defaults and warns (to console + toast) about unknown values.

```jsonc
{
  "clipcast": 1,                        // version — always 1
  "name": "My clip",
  "aspect": "9:16",                     // "9:16" | "1:1" | "16:9" | "4:5"
  "trim": { "start": 2.0, "end": 5.0 }, // seconds INTO the source audio
  "template": "podcast-minimal",        // podcast-minimal | hormozi | neon-rings | quote-card | lofi-desk | breaking-news
  "bg": { "type": "aurora", "c1": "#0f172a", "c2": "#134e4a", "angle": 135, "src": "data:image/…" },
                                        // type: solid | grad1..grad4 | paper | grid | dots | chalk | neon | sunset | aurora | custom | image
  "wf": {                               // waveform style
    "style": "bars",                    // bars | filled | mirror | radial | dots | spectrum
    "bars": 48, "gap": 0.18, "rounded": true,
    "color": "#2dd4bf", "color2": "#374151", "lineWidth": 2.5, "rows": 5,
    "bounce": true, "playhead": true, "meter": false, "sparkles": false
  },
  "blocks": [
    {
      "type": "title",                  // title | subtitle | waveform | cover | progress | timer | watermark
      "x": 0.5, "y": 0.14,              // center position: fraction (≤1) OR px (>1) OR keyword left/center/right/top/bottom/middle
      "w": 0.84, "h": 0.1,              // size: fraction or px
      "text": "My Podcast", "font": "montserrat", "size": 0.075, "color": "#f8fafc",
      "bold": true, "caps": false, "align": "center", "outline": 0, "shadow": true
      // cover extras: "src": "data:image/…", "rounded": 0.05, "kenburns": true, "grayscale": false
      // progress: "color", "track", "height": 0.008, "glow": true
      // timer: "format": "elapsed"|"remaining", "chip": true
    }
  ],
  "captions": {
    // exactly ONE of: cues | srt | text
    "cues": [ { "start": 0.0, "end": 1.7, "text": "Hello" } ],   // seconds relative to trim start
    "srt": "1\n00:00:00,000 --> 00:00:01,700\nHello",            // raw SRT/VTT string
    "text": "Hello world", "wordsPerLine": 4,                    // plain transcript, auto-distributed
    "style": {
      "mode": "karaoke",                // karaoke | phrase | bigword | none
      "font": "inter",                  // inter | montserrat | oswald | anton | bebas | merriweather | pacifico | caveat | system
      "size": 0.075,                    // fraction of canvas HEIGHT
      "color": "#f1f5f9", "hl": "#2dd4bf", "dim": "#94a3b8",
      "outline": 0.02, "outlineColor": "#0b0e14", "shadow": true,
      "caps": false, "maxWords": 4, "position": "bottom",        // top | middle | bottom
      "align": "center"
    }
  },
  "audio": { "src": "data:audio/wav;base64,…", "volume": 1, "normalize": true },
  "bgm":   { "src": "data:audio/wav;base64,…", "volume": 0.5, "duck": true, "loop": true, "duckDb": 8 }
}
```

**Import behavior (documented honesty):**
- Unknown enum values → warning + sensible default (never a hard failure).
- Unknown block types → warning + skipped.
- Coordinates: `|v| ≤ 1` = canvas fraction; `|v| > 1` = pixels; keywords `left/top = 0`, `center/middle = 0.5`, `right/bottom = 1`.
- Per-word karaoke timing is **interpolated evenly** inside each cue — the spec carries cue boundaries, not real word alignments.

---

## 🎬 Screenshots

*(Placeholder — capture the welcome screen, a template on the stage, the trim/caption panels,
and an exported frame; drop images into `assets/` and reference them here.)*

| Welcome | Podcast Minimal | Hormozi Captions |
|---|---|---|
| *(add `assets/welcome.png`)* | *(add `assets/template-podcast.png`)* | *(add `assets/template-hormozi.png`)* |

| Neon Rings | Export dialog | Exported frame |
|---|---|---|
| *(add `assets/template-neon.png`)* | *(add `assets/export.png`)* | *(add `assets/exported-frame.png`)* |

---

## ⌨️ Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause |
| `←` / `→` (hold `Shift` = ±5 s) | Seek |
| `S` | Split caption cue at playhead (snaps to word boundary) |
| `T` | Trim end = playhead |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+S` | Download project `.json` |
| `Ctrl+E` | Export |
| `Del` | Delete selected block |
| `Esc` | Close any dialog / end tour |

---

## 🧪 Testing

The acceptance suite drives the app in headless Chromium and verifies every box of the spec with
real probes (`ffprobe`, `ffmpeg silencedetect`, pixel analysis):

```bash
npm i playwright-core            # dev-only dependency
npx playwright-core install chromium --with-deps   # one-time browser download
ffmpeg -version                  # system ffmpeg required for probes

node test/run.mjs                # full suite (80 checks)
node test/run.mjs export         # single section
```

Covered: welcome→sample→play with audible graph · trim-stop-at-2.0 s · SRT/karaoke indices ·
6 waveform styles × 3 caption modes × 4 aspects × 13 backgrounds (contact sheets in
`test/out/render/`) · 3 s WebM with VP9+Opus, duration 3.00 s, silencedetect audio-window proof ·
GIF89a validity · PNG snapshot + thumbnail · `.json` round-trip (fresh page import, state
identical, audio plays) · hand-written spec with bad ids (warn-and-skip) · `node --check` on all
files · zero console errors.

## 📄 License & fonts

ClipCast is released under the **MIT License** (see [`LICENSE`](LICENSE)). All bundled fonts are
**SIL Open Font License** licensed: Inter, Montserrat, Oswald, Anton, Bebas Neue, Merriweather,
Pacifico, Caveat — redistribution permitted.

Made with ❤️ for podcasters, creators and people who believe "free" shouldn't mean watermarked.
