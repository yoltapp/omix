# Omix

A quiet little browser app for mixing background audio into a video.

Drop an `.mp4`, add any number of `.mp3` or `.wav` tracks, set per-track volume, mute what you do not want, and export a new `.mp4` directly in the browser with `ffmpeg.wasm`.

## What It Does

- Drag and drop video and audio files anywhere on the page
- Add multiple background tracks
- Mute individual tracks or mute/clear them all
- Set a default volume for newly added tracks
- Mix the original clip audio with enabled background tracks
- Download the final video without leaving the browser

## Why It Exists

Sometimes you do not need a timeline editor.

Sometimes you just need:

- one clip
- a few audio layers
- simple volume control
- a fast export

That is Omix.

## Run It

### Option 1: Local Static Server

Install dependencies:

```bash
npm install
```

Serve the project from the repo root:

```bash
python3 -m http.server 4173
```

Then open:

```text
http://127.0.0.1:4173
```

Do not open `index.html` via `file://`. `ffmpeg.wasm` needs a local server context.

### Option 2: Docker

Build and run:

```bash
docker compose up --build
```

Then open:

```text
http://127.0.0.1:4173
```

## Tech

- Plain HTML, CSS, and JavaScript
- `ffmpeg.wasm` for in-browser export
- No backend
- No upload step

## Notes

- Export runs locally in your browser, so large files can take time.
- The app keeps the original video audio and mixes enabled background tracks on top.
- The local static-server path expects `node_modules` to exist in the project root.

## License

MIT
