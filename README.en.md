# Parallel Reader

[中文](README.md) | [English](README.en.md)

A lightweight, self-hosted Markdown reader. Read one document in a focused layout, or select a source and translation for synchronized side-by-side reading.

Translations are created with an external tool such as ChatGPT. Parallel Reader does not call a translation API and does not require an API key.

![Side-by-side reading demo](docs/images/parallel-reader-demo.gif)

## Features

- Focused single-document reading with click-controlled paragraph highlighting and independently saved library progress
- Side-by-side reading with paragraph-jump synchronization and linked highlighting
- Automatic alignment for headings, paragraphs, lists, quotes, code blocks, and tables
- Manual alignment corrections and saved reading progress
- Open Markdown temporarily in browser memory without uploading files, progress, or alignment
- Import, rename, and delete local Markdown, or load an existing Markdown directory read-only
- Collapsible controls and an adjustable desktop split
- Select words or phrases in the English pane, capture their source sentences, and copy the batch as a ChatGPT study prompt
- Automatic stacked layout on mobile
- No frontend build step, CDN, or translation API dependency

## Frontend-only temporary reading

The **Open temporary files** workflow does not require `app.py`. Open `static/index.html` directly in a modern browser, or serve the `static/` directory as an ordinary static website.

The browser reads the Markdown files directly. Rendering, automatic alignment, synchronized navigation, and manual corrections all run in the current page. File contents are never uploaded; reading progress and alignment are not persisted and disappear when the page is closed or refreshed.

The server's read-only document directory, document library, and persistent progress are unavailable in frontend-only mode. The page may report that the library backend is unavailable, but temporary reading still works.

## Full application

Run the Python backend when you need a read-only document directory, the server library, or persistent progress. [uv](https://docs.astral.sh/uv/) is recommended:

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

1. Prepare one Markdown file; add a translated copy when you want side-by-side reading.
2. Use **Open temporary files** to keep them in the current page, use **Import to library** for persistent storage, or place existing files in `documents/`.
3. Choose single-document or side-by-side mode, select the document or documents, and start reading.
4. Click a paragraph for linked highlighting, and use manual alignment when needed.

To ask ChatGPT to create a strictly aligned document pair from English text or a public URL, use the [document-generation prompt (Chinese)](docs/translation-prompt.zh-CN.md).

Library imports, paragraph mappings, and reading progress are stored in `data/`. When either side of a pair is temporary, its files, mappings, and progress remain only in the current page memory and disappear when the page is closed or refreshed. Persistent data is ignored by Git by default.

The current vocabulary batch is stored only in the tab's `sessionStorage`: it survives a refresh, disappears when the tab is closed, and is never written to the server or SQLite.

## Docker deployment

Docker is convenient for a VPS or long-running installation:

```bash
mkdir -p data documents
docker compose up -d
```

The default mounts use the project-local `data/` and `documents/` directories. To use other host paths, set `DOCUMENTS_PATH` and `READER_DATA_PATH` in `.env`:

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
