# Gif Picker

Local-first desktop media picker built with **Tauri 2** and **React 19**.

Browse, search, tag, and copy GIFs, images, and videos from folders on your machine. Library metadata stays on your computer — network access is only used when you explicitly import from Discord.

## Features

- Watch multiple local folders (GIF, WebP, PNG, JPG, and optional video formats)
- Virtual scrolling grid with thumbnails, hover preview, and preview modal
- Search by filename, tag, or keyword; favorites and tags
- Copy to clipboard (optional always-copy-as-.gif)
- Light/dark mode, configurable grid and thumbnail memory
- Settings for excluded files, duplicate finder, blur tags, and Discord import
- Keyboard shortcuts (`Ctrl+F` search, `Ctrl+C` copy, `Delete` exclude, `Esc` close)

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