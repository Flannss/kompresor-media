# ADR-001: KOMPRESOR MEDIA Client-Side Architecture Lock

- **Status:** Accepted (Locked after Phase 1 Technical Feasibility Spike `KM-T001`)
- **Date:** 2026-11-26
- **Context:** KOMPRESOR MEDIA must run 100% locally in the browser with zero server uploads and deploy cleanly to static sub-path hosting (GitHub Pages via `base: './'`) without requiring `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers (`window.crossOriginIsolated === false`).

---

## 1. Locked Stack & Hosting Decisions

| Area | Decision | Rationale |
| --- | --- | --- |
| App Framework & Build | **Vite 8 + React 19 + TypeScript (strict)** | Fast ES module bundling (`worker: { format: 'es' }`) and relative static hosting (`base: './'`). |
| Styling & UI System | **Tailwind CSS v4 (`@tailwindcss/vite`) + Aquatic Clean Tokens** | Utility styling with contrast-audited CSS variables, zero runtime CSS-in-JS overhead, and strict Anti-AI Slop layout discipline. |
| State Management | **Zustand** | Minimal predictable store for active media asset, metadata, ObjectURL lifecycle, and engine state. |
| Testing | **Vitest + jsdom + @testing-library/react** | Fast unit and DOM lifecycle verification integrated in CI before production build. |
| Deployment | **GitHub Pages (`base: './'`) via GitHub Actions** | Verified in headless Chrome 158 at root (`vite preview`) and sub-path (`/kompresor/spike/`) with zero 404/MIME/CORS errors. |

---

## 2. Locked Photo Processing Architecture (Phase 4)

- **Decision:** Dedicated ES module **Web Worker + `OffscreenCanvas`** with automatic **main-thread `HTMLCanvasElement` fallback** when `typeof OffscreenCanvas === 'undefined'` in worker scope.
- **Phase 1 Empirical Benchmarks** (`test_2400x1600.png`: `2400 x 1600`, `1,964,198 B` -> `1600 x 1067`, 3x3 sharpen `0.5`, `quality = 0.82`, worker bundle `1,756 B`):
  - **JPEG (`image/jpeg`):** `95.70 ms` end-to-end (`83.60 ms` worker: decode `17.90 ms`, resize+sharpen `51.80 ms`, encode `13.90 ms`), output `724,828 B` (`63.10%` reduction).
  - **WebP (`image/webp`):** `233.90 ms` end-to-end (`229.10 ms` worker: decode `18.20 ms`, resize+sharpen `47.70 ms`, encode `163.20 ms`), output `538,254 B` (`72.60%` reduction).
- **Memory & Privacy Discipline:** All preview URLs (`URL.createObjectURL`) must be explicitly revoked via `URL.revokeObjectURL` upon file replacement, export cleanup, and component unmount.

---

## 3. Locked Video Processing Architecture (Phase 5)

- **Decision:** **Hybrid Primary + Universal Fallback**:
  1. **Primary Fast Path:** **WebCodecs + `mediabunny`** when runtime capability probes confirm required decoders/encoders and container compatibility.
  2. **Universal Fallback Path:** **Lazy-loaded single-threaded `@ffmpeg/ffmpeg` + `@ffmpeg/core`** (no `SharedArrayBuffer`, no COOP/COEP) via dynamic `import()` for unsupported containers (e.g., WebM), missing browser hardware/codec support (e.g., Firefox or Linux Chromium without proprietary AAC/H.264 encoders), or complex filter pipelines.
- **Why `mediabunny` Replaces `mp4-muxer`:** During Phase 1 `npm install`, `mp4-muxer@5.2.2` emitted a deprecation notice (`"This library is superseded by Mediabunny. Please migrate to it."`). Production Phase 5 will adopt `mediabunny` rather than building on a deprecated muxer.
- **Phase 1 Empirical Video Comparison** (`test_1080p_8s.mp4`: `1920 x 1080` @ `24 fps`, `avc1.42c028` + `mp4a.40.2` 48kHz stereo, `8.000 s`, `9,157,951 B`; scaled to `1280 x 720`, trimmed `1.0 s..6.0 s`, audio intact):
  - **Candidate A (WebCodecs):** `1,018.40 ms` total (`demux=11.30 ms`, `transcode=967.50 ms`, `~5.9x` faster than FFmpeg ST), `0 B` WASM payload, output `1,733,527 B` (`81.07%` reduction at `1.5 Mbps`), verified audio (`48000 Hz`, `2 ch`, `5.013 s`, `rms = 0.2466`). Note: trimming required `firstTimestampBehavior: 'offset'` because AAC frame boundaries do not align to exact `0` offset, and `mp4box` `avcC` extraction required `DataStream` + 8-byte header stripping.
  - **Candidate B (`@ffmpeg/ffmpeg@0.12.15` + `@ffmpeg/core@0.12.10` ST):** `window.crossOriginIsolated === false`, lazy-load `770.60 ms` (`128.90 ms` cached subpath, `138.40 ms` post-terminate re-init, `6,410.60 ms` under earlier CPU contention), asset sizes `111,804 B` JS + `32,232,419 B` WASM (`32.34 MB`), `6,022.80 ms` total (`-preset ultrafast -crf 28`), output `7,657,394 B` (`16.39%` reduction), `13` real `progress` events, verified audio (`48000 Hz`, `2 ch`, `5.000 s`, `rms = 0.2465`). Mid-run cancellation via `ffmpeg.terminate()` aborted in `765.20 ms` (after 2 progress events) and cleanly re-initialized on the subsequent `0..3 s` run (`4,610,811 B`, `49.65%` reduction, `rms = 0.2472`, `3,550.20 ms`).
- **Bundle & Git Hygiene Rules:**
  - Keep `public/ffmpeg/` out of Git (`.gitignore` excludes `public/ffmpeg/`). Copy `@ffmpeg/core` ESM/WASM assets at install/build time in Phase 5.
  - Dynamically `import()` all heavy video libraries (`mediabunny`, `@ffmpeg/ffmpeg`) on demand so initial page JavaScript remains well under Vite's `500 kB` chunk threshold (spike's unsplit main bundle was `502.87 kB` / `137.34 kB` gzip).
