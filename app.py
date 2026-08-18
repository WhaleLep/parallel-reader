import json
import mimetypes
import os
import sqlite3
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit


BASE_DIR = Path(__file__).resolve().parent
DOCUMENTS_DIR = Path(os.environ.get("DOCUMENTS_DIR", BASE_DIR / "documents")).resolve()
DATA_DIR = Path(os.environ.get("DATA_DIR", BASE_DIR / "data")).resolve()
LOCAL_DOCUMENTS_DIR = DATA_DIR / "documents"
STATIC_DIR = Path(os.environ.get("STATIC_DIR", BASE_DIR / "static")).resolve()
DB_PATH = DATA_DIR / "reader.db"
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8084"))
MAX_BODY = 1024 * 1024
MAX_DOCUMENT = 10 * 1024 * 1024


def connect_db():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def initialize_db():
    DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LOCAL_DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)
    with connect_db() as db:
        db.executescript(
            """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS pairs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                translation TEXT NOT NULL,
                mapping TEXT NOT NULL DEFAULT '{}',
                updated_at INTEGER NOT NULL,
                UNIQUE(source, translation)
            );
            CREATE TABLE IF NOT EXISTS progress (
                pair_id INTEGER PRIMARY KEY,
                source_block INTEGER NOT NULL DEFAULT 0,
                translation_block INTEGER NOT NULL DEFAULT 0,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(pair_id) REFERENCES pairs(id) ON DELETE CASCADE
            );
            """
        )
        db.execute("UPDATE pairs SET source='readonly:' || substr(source, 6) WHERE source LIKE 'wiki:%'")
        db.execute("UPDATE pairs SET translation='readonly:' || substr(translation, 6) WHERE translation LIKE 'wiki:%'")
        db.execute(
            "UPDATE pairs SET source='readonly:' || source "
            "WHERE source NOT LIKE 'readonly:%' AND source NOT LIKE 'local:%'"
        )
        db.execute(
            "UPDATE pairs SET translation='readonly:' || translation "
            "WHERE translation NOT LIKE 'readonly:%' AND translation NOT LIKE 'local:%'"
        )


def safe_local_name(name):
    if not isinstance(name, str):
        raise ValueError("无效的文件名")
    name = name.strip()
    if (
        not name
        or len(name) > 200
        or not name.lower().endswith(".md")
        or name in (".", "..")
        or "/" in name
        or "\\" in name
        or any(ord(character) < 32 for character in name)
    ):
        raise ValueError("请输入有效的 Markdown 文件名")
    return name


def safe_document(identifier):
    if not isinstance(identifier, str) or not identifier.lower().endswith(".md"):
        raise ValueError("仅支持 Markdown 文档")
    if identifier.startswith("local:"):
        root = LOCAL_DOCUMENTS_DIR
        clean = safe_local_name(identifier[6:])
        normalized = f"local:{clean}"
    else:
        root = DOCUMENTS_DIR
        if identifier.startswith("readonly:"):
            clean = identifier[9:]
        elif identifier.startswith("wiki:"):
            clean = identifier[5:]
        else:
            clean = identifier
        clean = clean.replace("\\", "/").lstrip("/")
        normalized = f"readonly:{clean}"
    target = (root / clean).resolve()
    try:
        target.relative_to(root)
    except ValueError as error:
        raise ValueError("无效的文档路径") from error
    if not target.is_file():
        raise FileNotFoundError("文档不存在")
    if target.stat().st_size > MAX_DOCUMENT:
        raise ValueError("文档超过 10 MiB")
    return target, normalized


def list_documents():
    documents = []
    for path in sorted(DOCUMENTS_DIR.rglob("*.md"), key=lambda item: str(item).lower()):
        if not path.is_file():
            continue
        relative = path.relative_to(DOCUMENTS_DIR).as_posix()
        stat = path.stat()
        documents.append(
            {
                "path": f"readonly:{relative}",
                "name": path.stem,
                "origin": "readonly",
                "display_path": relative,
                "modified_at": int(stat.st_mtime),
                "size": stat.st_size,
            }
        )
    for path in sorted(LOCAL_DOCUMENTS_DIR.glob("*.md"), key=lambda item: item.name.lower()):
        if not path.is_file():
            continue
        stat = path.stat()
        documents.append(
            {
                "path": f"local:{path.name}",
                "name": path.stem,
                "origin": "local",
                "display_path": path.name,
                "modified_at": int(stat.st_mtime),
                "size": stat.st_size,
            }
        )
    return documents


def read_request_body(handler, maximum=MAX_DOCUMENT):
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError as error:
        raise ValueError("无效的请求长度") from error
    if length <= 0 or length > maximum:
        raise ValueError("文件为空或超过 10 MiB")
    return handler.rfile.read(length)


def write_local_document(name, body, overwrite=False):
    name = safe_local_name(name)
    try:
        content = body.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("Markdown 文件必须使用 UTF-8 编码") from error
    target = LOCAL_DOCUMENTS_DIR / name
    if target.exists() and not overwrite:
        raise FileExistsError("同名文档已经存在")
    temporary = LOCAL_DOCUMENTS_DIR / f".{name}.{time.time_ns()}.tmp"
    try:
        temporary.write_text(content, encoding="utf-8")
        os.replace(temporary, target)
    finally:
        if temporary.exists():
            temporary.unlink()
    return f"local:{name}"


class ReaderHandler(BaseHTTPRequestHandler):
    server_version = "ParallelReader/1.0"

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}")

    def send_bytes(self, body, content_type, status=HTTPStatus.OK, cache="no-store"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_bytes(body, "application/json; charset=utf-8", status)

    def send_error_json(self, status, message):
        self.send_json({"error": message}, status)

    def read_json(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("无效的请求长度") from error
        if length <= 0 or length > MAX_BODY:
            raise ValueError("请求内容为空或过大")
        try:
            return json.loads(self.rfile.read(length))
        except json.JSONDecodeError as error:
            raise ValueError("无效的 JSON") from error

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        request = urlsplit(self.path)
        path = unquote(request.path)
        try:
            if path == "/healthz":
                return self.send_json({"status": "ok"})
            if path == "/api/documents":
                return self.send_json({"documents": list_documents()})
            if path == "/api/document":
                query = parse_qs(request.query)
                target, clean = safe_document(query.get("path", [""])[0])
                content = target.read_text(encoding="utf-8")
                return self.send_json(
                    {
                        "path": clean,
                        "content": content,
                        "modified_at": int(target.stat().st_mtime),
                    }
                )
            return self.serve_static(path)
        except FileNotFoundError as error:
            self.send_error_json(HTTPStatus.NOT_FOUND, str(error))
        except UnicodeDecodeError:
            self.send_error_json(HTTPStatus.UNPROCESSABLE_ENTITY, "文档不是有效的 UTF-8")
        except ValueError as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(error))
        except Exception:
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, "服务器处理请求失败")

    def do_POST(self):
        request = urlsplit(self.path)
        try:
            if request.path != "/api/pairs/open":
                return self.send_error_json(HTTPStatus.NOT_FOUND, "接口不存在")
            payload = self.read_json()
            _, source = safe_document(payload.get("source", ""))
            _, translation = safe_document(payload.get("translation", ""))
            if source == translation:
                raise ValueError("请选择两个不同的文档")
            now = int(time.time())
            with connect_db() as db:
                db.execute(
                    "INSERT OR IGNORE INTO pairs(source, translation, updated_at) VALUES (?, ?, ?)",
                    (source, translation, now),
                )
                pair = db.execute(
                    "SELECT id, source, translation, mapping FROM pairs WHERE source=? AND translation=?",
                    (source, translation),
                ).fetchone()
                progress = db.execute(
                    "SELECT source_block, translation_block FROM progress WHERE pair_id=?",
                    (pair["id"],),
                ).fetchone()
            self.send_json(
                {
                    "id": pair["id"],
                    "source": pair["source"],
                    "translation": pair["translation"],
                    "mapping": json.loads(pair["mapping"] or "{}"),
                    "progress": dict(progress) if progress else {"source_block": 0, "translation_block": 0},
                }
            )
        except FileNotFoundError as error:
            self.send_error_json(HTTPStatus.NOT_FOUND, str(error))
        except ValueError as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(error))
        except Exception:
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, "服务器处理请求失败")

    def do_PUT(self):
        request = urlsplit(self.path)
        parts = [part for part in request.path.split("/") if part]
        try:
            if request.path == "/api/local-document":
                query = parse_qs(request.query)
                name = query.get("name", [""])[0]
                overwrite = query.get("overwrite", ["0"])[0] == "1"
                identifier = write_local_document(name, read_request_body(self), overwrite)
                return self.send_json({"ok": True, "path": identifier}, HTTPStatus.CREATED)
            if len(parts) != 4 or parts[:2] != ["api", "pairs"]:
                return self.send_error_json(HTTPStatus.NOT_FOUND, "接口不存在")
            pair_id = int(parts[2])
            action = parts[3]
            payload = self.read_json()
            now = int(time.time())
            with connect_db() as db:
                exists = db.execute("SELECT 1 FROM pairs WHERE id=?", (pair_id,)).fetchone()
                if not exists:
                    return self.send_error_json(HTTPStatus.NOT_FOUND, "文档配对不存在")
                if action == "mapping":
                    mapping = payload.get("mapping")
                    if not isinstance(mapping, dict) or len(mapping) > 50000:
                        raise ValueError("无效的段落映射")
                    cleaned = {}
                    for source, target in mapping.items():
                        source_index = int(source)
                        target_index = int(target)
                        if source_index < 0 or target_index < 0:
                            raise ValueError("无效的段落编号")
                        cleaned[str(source_index)] = target_index
                    db.execute(
                        "UPDATE pairs SET mapping=?, updated_at=? WHERE id=?",
                        (json.dumps(cleaned, separators=(",", ":")), now, pair_id),
                    )
                elif action == "progress":
                    source_block = max(0, int(payload.get("source_block", 0)))
                    translation_block = max(0, int(payload.get("translation_block", 0)))
                    db.execute(
                        """
                        INSERT INTO progress(pair_id, source_block, translation_block, updated_at)
                        VALUES (?, ?, ?, ?)
                        ON CONFLICT(pair_id) DO UPDATE SET
                            source_block=excluded.source_block,
                            translation_block=excluded.translation_block,
                            updated_at=excluded.updated_at
                        """,
                        (pair_id, source_block, translation_block, now),
                    )
                else:
                    return self.send_error_json(HTTPStatus.NOT_FOUND, "接口不存在")
            self.send_json({"ok": True})
        except FileExistsError as error:
            self.send_error_json(HTTPStatus.CONFLICT, str(error))
        except (TypeError, ValueError) as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(error))
        except Exception:
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, "服务器处理请求失败")

    def do_PATCH(self):
        request = urlsplit(self.path)
        try:
            if request.path != "/api/local-document":
                return self.send_error_json(HTTPStatus.NOT_FOUND, "接口不存在")
            payload = self.read_json()
            old_target, normalized = safe_document(payload.get("path", ""))
            if not normalized.startswith("local:"):
                raise ValueError("只能改名本地文档")
            new_name = safe_local_name(payload.get("name", ""))
            new_target = LOCAL_DOCUMENTS_DIR / new_name
            if new_target.exists() and new_target != old_target:
                raise FileExistsError("同名文档已经存在")
            new_identifier = f"local:{new_name}"
            old_target.rename(new_target)
            try:
                with connect_db() as db:
                    db.execute("UPDATE pairs SET source=? WHERE source=?", (new_identifier, normalized))
                    db.execute("UPDATE pairs SET translation=? WHERE translation=?", (new_identifier, normalized))
            except Exception:
                new_target.rename(old_target)
                raise
            self.send_json({"ok": True, "path": new_identifier})
        except FileNotFoundError as error:
            self.send_error_json(HTTPStatus.NOT_FOUND, str(error))
        except FileExistsError as error:
            self.send_error_json(HTTPStatus.CONFLICT, str(error))
        except (TypeError, ValueError) as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(error))
        except sqlite3.IntegrityError:
            self.send_error_json(HTTPStatus.CONFLICT, "改名后会与现有文档配对冲突")
        except Exception:
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, "服务器处理请求失败")

    def do_DELETE(self):
        request = urlsplit(self.path)
        try:
            if request.path != "/api/local-document":
                return self.send_error_json(HTTPStatus.NOT_FOUND, "接口不存在")
            query = parse_qs(request.query)
            target, normalized = safe_document(query.get("path", [""])[0])
            if not normalized.startswith("local:"):
                raise ValueError("只能删除本地文档")
            with connect_db() as db:
                pair_ids = [
                    row["id"]
                    for row in db.execute(
                        "SELECT id FROM pairs WHERE source=? OR translation=?",
                        (normalized, normalized),
                    )
                ]
                if pair_ids:
                    placeholders = ",".join("?" for _ in pair_ids)
                    db.execute(f"DELETE FROM progress WHERE pair_id IN ({placeholders})", pair_ids)
                db.execute("DELETE FROM pairs WHERE source=? OR translation=?", (normalized, normalized))
                target.unlink()
            self.send_json({"ok": True})
        except FileNotFoundError as error:
            self.send_error_json(HTTPStatus.NOT_FOUND, str(error))
        except (TypeError, ValueError) as error:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(error))
        except Exception:
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, "服务器处理请求失败")

    def serve_static(self, request_path):
        relative = "index.html" if request_path in ("", "/") else request_path.lstrip("/")
        target = (STATIC_DIR / relative).resolve()
        try:
            target.relative_to(STATIC_DIR)
        except ValueError:
            return self.send_error_json(HTTPStatus.NOT_FOUND, "资源不存在")
        if not target.is_file():
            return self.send_error_json(HTTPStatus.NOT_FOUND, "资源不存在")
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in ("application/javascript", "application/json"):
            content_type += "; charset=utf-8"
        cache = "public, max-age=86400" if target.suffix.lower() in (".jpg", ".png", ".svg") else "no-cache"
        self.send_bytes(target.read_bytes(), content_type, cache=cache)


if __name__ == "__main__":
    initialize_db()
    server = ThreadingHTTPServer((HOST, PORT), ReaderHandler)
    print(f"Parallel Reader listening on http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nParallel Reader stopped")
    finally:
        server.server_close()
