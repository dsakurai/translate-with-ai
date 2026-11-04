# Paragraph Editor

A minimal React editor served by Deno. It edits one local document through a
same-origin Deno endpoint. The editor is unauthenticated for this local demo.

## Run in the devcontainer

```sh
deno task start
```

Open the **Paragraph editor** port (8000). The app only edits TOML files using
the structured paragraph editor.

TOML documents use an array of `paragraph` tables, each with string `original`
and `translated` values. The editor writes values as TOML multiline basic
strings (`"""..."""`), preserving line breaks in paragraph text:

```toml
[[paragraph]]
original = """hello, my name is Tom."""
translated = """こんにちは，私の名前はトム．"""
```

Paragraphs can be edited, added, removed, and reordered by dragging their
handle. **Undo** and **Redo** (Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y) reverse
paragraph edits, removals, and movements. Keyboard shortcuts are left to the
browser while a text field is focused. Changes are saved automatically after a
short pause. The status indicator shows when changes are saving, saved, or need
attention; a failed write can be retried. The editor checks for external file
changes every three seconds and lets you load the external version or keep your
editor contents.

Malformed TOML is not overwritten automatically. The editor shows a validation
error and offers an explicit **Replace with empty list** action to repair the
document.

## Configuration

| Variable      | Default             | Description                          |
| ------------- | ------------------- | ------------------------------------ |
| `APP_PORT`    | `8000`              | Port for the editor and document API |
| `EDITOR_FILE` | `translations.toml` | TOML filename stored under `data/`   |

`EDITOR_FILE` must be a simple filename ending in `.toml`, without directory
components. The default file is created with two example paragraphs on first
start. Other new TOML files are created empty. Existing files are not changed on
startup. The `data/` directory is ignored by Git.

## Access and transport

This demo has no authentication. `deno task start` builds and runs the app; Deno
reads and writes only the configured TOML file under `data/`. The app serves
plain HTTP; use it only for local development or on a trusted network, and add
authentication and TLS before exposing it elsewhere.

## Validate

```sh
deno check main.ts src/main.tsx build.ts
deno task build
```
