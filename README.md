# Gif Picker

Local-first desktop media picker built with **Tauri 2** and **React 19**.

Browse, search, tag, and copy GIFs and videos from folders on your machine. All library data stays on your computer — no network calls.

## Features

- Watch multiple local folders (GIF, WebP, PNG, and optional video formats)
- Virtual scrolling grid with static first-frame thumbnails
- Search by filename, tag, or keyword
- Favorites, tags, per-file keywords, and excluded files
- Copy to clipboard (optional always-copy-as-.gif)
- Hover preview, full preview modal, and keyboard shortcuts
- Custom frameless window with native clipboard integration

## Requirements

- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/tools/install) (for Tauri)

## Development

```bash
npm install
npm run tauri:dev
```

The Vite dev server runs on port **1425**.

## Build

```bash
npm run tauri:build
```

Windows installers are written to `src-tauri/target/release/bundle/`.

## Project structure

```
gif-picker/
├── public/              # Static web assets (favicon)
├── src/                 # React frontend
├── src-tauri/           # Rust / Tauri backend
├── package.json
└── README.md
```

## Data storage

Your folders, tags, favorites, and settings are **not** stored in this repository. They live in the OS app-data directory:

| Platform | Location |
|---|---|
| Windows | `%APPDATA%\com.gifpicker\` |
| macOS | `~/Library/Application Support/com.gifpicker/` |
| Linux | `~/.local/share/com.gifpicker/` |

| File | Contents |
|---|---|
| `gif-picker-library.json` | Watched folders, favorites, tags, keywords, excluded paths |
| `gif-picker-settings.json` | Grid, clipboard, and thumbnail settings |
| `gif-picker-session.json` | Sidebar view, search, and library/settings mode |

Config survives dev builds, release installs, and moving the project folder. It is tied to the app identifier (`com.gifpicker` in `src-tauri/tauri.conf.json`).

## License

MIT — see [LICENSE](LICENSE).