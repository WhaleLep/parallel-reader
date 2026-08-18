# Parallel Reader

[中文](README.md) | [English](README.en.md)

A lightweight, self-hosted bilingual Markdown reader. Select a source document and its translation to read them side by side with synchronized navigation, linked highlighting, and adjustable paragraph alignment.

Translations are created with an external tool such as ChatGPT. Parallel Reader does not call a translation API and does not require an API key.

![Side-by-side reading demo](docs/images/parallel-reader-demo.gif)

## Features

- Side-by-side reading with paragraph-jump synchronization and linked highlighting
- Automatic alignment for headings, paragraphs, lists, quotes, code blocks, and tables
- Manual alignment corrections and saved reading progress
- Import, rename, and delete local Markdown, or load an existing Markdown directory read-only
- Collapsible controls and an adjustable desktop split
- Automatic stacked layout on mobile
- No frontend build step, CDN, or translation API dependency

## Quick start

[uv](https://docs.astral.sh/uv/) is recommended:

```bash
git clone https://github.com/WhaleLep/parallel-reader.git
cd parallel-reader
uv run python app.py
```

Open <http://127.0.0.1:8084>. The app creates `data/` and `documents/` on first launch. Press `Ctrl+C` to stop it.

You can also run it directly with Python 3.10 or newer:

```bash
python3 app.py
```

## Basic usage

1. Prepare two Markdown files: the original document and its translation.
2. Import them from the browser, or place existing files in `documents/`.
3. Select both documents and start the comparison.
4. Click a paragraph for linked highlighting, and use manual alignment when needed.

To ask ChatGPT to create a strictly aligned document pair from English text or a public URL, use the [document-generation prompt (Chinese)](docs/translation-prompt.zh-CN.md).

Imported files, paragraph mappings, and reading progress are stored in `data/`. They are ignored by Git by default.

## Docker deployment

Docker is convenient for a VPS or long-running installation:

```bash
mkdir -p data documents
docker compose up -d
```

The default mounts use the project-local `data/` and `documents/` directories. To use other host paths:

```bash
cp .env.example .env
# Edit the paths in .env, then run:
docker compose up -d
```

Compose binds the service to `127.0.0.1:8084` only. For public access, place an HTTPS reverse proxy with authentication in front of it instead of exposing the backend port.

## Project structure

```text
parallel-reader/
├── app.py                  # Python standard-library backend
├── static/                 # Frontend assets
├── compose.yaml            # Docker deployment
├── pyproject.toml          # uv / Python project configuration
├── uv.lock                 # uv lock file
├── documents/              # Read-only Markdown source (ignored)
└── data/                   # Imported documents and SQLite data (ignored)
```

The backend uses only the Python standard library and SQLite. Marked is bundled for Markdown rendering; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for license information.

## License

[MIT](LICENSE)
