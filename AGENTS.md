# Agent Instructions

## Project Context

- This repository is `gif-picker`, a local-first desktop media picker.
- Tech stack: Tauri 2, Rust, React 19, TypeScript, Vite, Zustand.
- The app scans user-selected local folders for GIFs, images, and optional video files.
- Library metadata and settings are stored in the OS app-data directory, not in this repository.
- Network access should be limited to explicit user actions, such as Discord import or update checks.

## Shared Operating Rules

- Keep changes focused on the active task only.
- Do not include unrelated local changes in commits.
- Avoid unrelated refactors in feature or bug-fix work.
- Prefer maintainable, long-term solutions over quick fixes.
- Follow existing project structure, naming, styling, and state-management patterns.
- Keep responsibilities in the correct layer:
  - React components own UI and interaction.
  - Zustand store owns persisted library/settings/session state.
  - Tauri commands own OS integration, clipboard operations, downloads, file hashing, and app-data migration.
- Create or switch branches only when the user explicitly asks.
- Create commits only when the user explicitly asks.
- Push branches only when the user explicitly asks.
- Keep all repository content in English.
- Use English for identifiers, comments, user-facing strings, commit messages, PR titles, and PR descriptions.
- Use Hungarian only in direct chat conversation with the user when requested.

## Pre-Change Review

- Before modifying code, inspect the relevant nearby files first.
- For UI work, review the target component, related UI primitives, store usage, and CSS rules.
- For persistence work, review `src/store/useLibraryStore.ts` and app-data file handling.
- For Tauri/Rust work, review `src-tauri/src/lib.rs`, `src-tauri/tauri.conf.json`, and capability files.
- Reuse existing helpers and patterns before introducing new abstractions.

## Development Commands

- Install dependencies:
  - `npm install`
- Start the desktop app in development:
  - `npm.cmd run tauri:dev`
- Build the frontend:
  - `npm.cmd run build`
- Build the desktop app:
  - `npm.cmd run tauri:build`
- Preview the Vite build when needed:
  - `npm.cmd run preview`

Use `npm.cmd` on Windows PowerShell to avoid execution-policy issues with `npm.ps1`.

## Quality Gates

- Before finalizing code changes, run the relevant checks for the touched area.
- For frontend-only changes, run:
  - `npm.cmd run build`
- For Tauri/Rust or release-sensitive changes, run:
  - `npm.cmd run tauri:build`
- If dependencies are changed, run:
  - `npm.cmd audit --package-lock-only`
- There is no dedicated test script in `package.json` at the time of writing. If tests are added later, update this file with the canonical test command.
- If a check cannot be run because dependencies, Rust, platform tooling, or network access are unavailable, state that clearly in the final response.

## Tauri and Security Guidelines

- Treat file-system permissions as security-sensitive.
- Do not broaden Tauri capabilities unless the feature explicitly requires it.
- Prefer narrowing scopes over adding global permissions.
- Be careful with `open_url`, `open_path`, clipboard, updater, and file-system APIs.
- Do not add arbitrary command execution or shell invocation.
- Do not add hidden background network calls.
- Do not store secrets, tokens, credentials, or Discord account data in the repository or app-data files.
- Keep Discord import explicit and user-driven.
- Validate and sanitize file names for downloaded media.
- Preserve local-first behavior: user media stays on the user's machine unless the user explicitly chooses a network action.

## UI and Frontend Guidelines

- Use functional React components and hooks.
- Reuse existing UI primitives in `src/components/ui` before creating new controls.
- Keep global app state in the existing Zustand store unless state is truly local.
- Keep CSS consistent with `src/styles/globals.css`.
- Avoid one-off styling patterns when an existing class or component pattern fits.
- Preserve keyboard shortcuts and modal/escape behavior when changing interactions.
- Keep large media lists virtualized and avoid render-path work that scales poorly with library size.
- For user-facing text, keep wording concise and in English.

## Data and Persistence Guidelines

- Persist only app metadata, settings, and session state in app-data JSON files.
- Do not write user media files except for explicit flows such as Discord downloads or clipboard staging.
- "Exclude" means hide from the app library; it must not delete the source file.
- Keep path normalization consistent with existing helpers.
- Avoid duplicating persistence logic outside `src/store/useLibraryStore.ts` unless there is a clear ownership reason.
- Preserve backwards-compatible app-data migration behavior unless deliberately changing the app-data contract.

## Commit and PR Rules

- Use Conventional Commit style for commit messages and PR titles (`feat:`, `fix:`, `chore:`, `docs:`, etc.).
- Keep commits focused and minimal.
- Review staged files before committing.
- Do not commit generated build outputs, local app-data files, dependency caches, or unrelated workspace changes.
- If a change affects behavior that can be tested automatically, add or update tests when a test framework exists.
- If tests are not added, explain the validation performed and why automated tests were not added.

## PR Description Guidance

When asked for a PR description, write it in English and provide it in one Markdown code block so it can be copied directly into GitHub.

Use a concise structure like this:

```markdown
type: short PR title

## Summary
- Briefly describe the user-facing or developer-facing outcome.
- Mention only the important implementation points.

## Validation
- List the checks that were run, such as `npm.cmd run build`.
- If a relevant check was not run, explain why in one short sentence.

## Notes
- Call out risks, follow-up work, or manual verification details when relevant.
```

Keep the description focused on the final state of the change. Do not include step-by-step implementation history or unrelated cleanup notes.
