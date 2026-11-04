# Paragraph Editor

A translator-assistance app for reviewing and editing source text and
translations, with a web interface that AI agents can use to help with
translation. It is served by Deno and edits one local document through a
same-origin endpoint. The app is unauthenticated for this local demo.

Because the editor runs in a web page, an AI agent can help translate by
working directly in the editor. You can use an agent in VS Code that can
interact with the page, or an agentic browser.

The app saves your work in a file, but does not keep a history of changes by
itself. If you also save that file in Git, Git can show what changed and let you
return to an earlier version. The app's default `data/` folder is not included
in Git, so ask someone familiar with the project to set this up if you want Git
to keep that history.

You can edit, add, remove, and reorder paragraphs by dragging their handle.
**Undo** and **Redo** (Ctrl+Z / Ctrl+Shift+Z or Ctrl+Y) reverse paragraph edits,
removals, and movements. Changes are saved automatically after a short pause.
The status indicator shows when changes are saving, saved, or need attention;
you can retry a failed save. Keyboard shortcuts are left to the browser while
you are typing in a text field.

## Translation file format

The app stores paragraphs in a TOML file, with the original text and its
translation kept together. For example:

```toml
[[paragraph]]
original = """hello, my name is Tom.
I live in Tokyo."""
translated = """こんにちは，私の名前はトムです．
東京に住んでいます．"""

[[paragraph]]
original = """Nice to meet you."""
translated = """はじめまして．"""
```

The editor checks for changes made to the file outside the app every three
seconds. It lets you load the newer version or keep your current edits.

Malformed TOML is not overwritten automatically. The editor shows a validation
error and offers an explicit **Replace with empty list** action to repair the
document.

## Run in the devcontainer

```sh
deno task start
```

Open the **Paragraph editor** port (8000).


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
