# LoopStream

A website + loop engine that turns **one pre-recorded video into a 24/7 live YouTube livestream** — looping forever, live all day and night.

Built for channels that need ambient / looping content on YouTube Live without a human sitting in front of OBS.

---

## How it works

```
Pre-recorded video ──► ffmpeg -stream_loop -1 ──► RTMP (YouTube stream key) ──► YouTube Live
```

1. You paste your **YouTube Live stream key** (YouTube Studio → Create → Go live → Stream key).
2. You point LoopStream at a **video file** (or a direct media URL).
3. LoopStream spawns **ffmpeg** with `-re -stream_loop -1` and pushes the looped stream over RTMP to `rtmp://a.rtmp.youtube.com/live2/<stream key>`.
4. Once connected, YouTube shows the stream **live** — looping forever.

## Features

- 🔁 **Infinite loop** — `ffmpeg -stream_loop -1` loops the source indefinitely (24/7, zero dead air).
- 🎬 **Live-grade encoding** — H.264 (`libx264`) + AAC audio, ~4.5 Mbps / 1080p30 target, low-latency live tune.
- 🛡️ **Auto-restart** — if the ffmpeg engine ever crashes, it restarts itself and keeps the loop alive.
- 🔑 **Stream key driven** — uses the official YouTube RTMP ingest URL built from your stream key.
- 📜 **Full visibility** — live status, uptime, and streaming logs in the dashboard.
- ⚡ **Zero babysitting** — start once, walk away; the loop runs unattended.

## Run it

### 1. Install ffmpeg

- Windows: download a static build (e.g. [gyan.dev](https://www.gyan.dev/ffmpeg/builds/)) and add `ffmpeg.exe` to your `PATH`, or set `FFMPEG_PATH=C:\path\to\ffmpeg.exe`.
- macOS: `brew install ffmpeg`
- Linux: `sudo apt install ffmpeg`

### 2. Start the server

```bash
node server.js
# or
PORT=8787 node server.js
```

Open <http://localhost:8787>.

### 3. Go live on YouTube

1. Open YouTube Studio → **Create** → **Go live**.
2. Copy the **Stream key**.
3. Paste it into the LoopStream dashboard.
4. Set the **video source** (local file path, e.g. `C:\Videos\ambient.mp4`, or a direct media URL).
5. Press **Start 24/7 loop**.

When the engine reports **Live**, YouTube shows your stream. Copy the watch URL (`https://www.youtube.com/live/<id>`) into your channel.

## API

| Method | Route | Body / Query | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | Liveness probe |
| GET | `/api/status` | — | `{status, uptimeSec, source, keyPreview}` |
| POST | `/api/stream/start` | `{streamKey, source:{kind:"file"|"url", value}}` | Validate + start ffmpeg loop |
| POST | `/api/stream/stop` | — | Stop the loop |
| GET | `/api/logs?lines=200` | — | Last N log lines |

## Engine notes

- Input: `-re -stream_loop -1 -i <src>`
- Output: `-c:v libx264 -preset veryfast -tune zerolatency -b:v 4500k -maxrate 6000k -bufsize 12000k -pix_fmt yuv420p -c:a aac -b:a 128k -f flv rtmp://a.rtmp.youtube.com/live2/<key>`

The `-re` flag paces input at real time (required for live-style pacing), `-stream_loop -1` loops forever.

## Project structure

```
loopstream/
  server.js       zero-dependency Node server (static + API)
  index.html      LoopStream dashboard page
  assets/style.css
  assets/app.js
  README.md
```
