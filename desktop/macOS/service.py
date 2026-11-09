"""Private loopback service for the macOS workspace."""
import hashlib
import json
from http.cookies import CookieError, SimpleCookie
from http.server import ThreadingHTTPServer
from pathlib import Path
import secrets
import sys
import tempfile
import threading

RESOURCES = Path(__file__).resolve().parent
sys.path.insert(0, str(RESOURCES / "prototype"))
import server as workbench

DATA = Path.home() / "Library/Application Support/ProductWorkbench"
STATE = DATA / "workspace.json"
LOCK = threading.Lock()
LIMIT = 32 * 1024 * 1024


class Handler(workbench.Handler):
    def parse_request(self):
        if not super().parse_request():
            return False
        cookies = SimpleCookie()
        try:
            cookies.load(self.headers.get("Cookie", ""))
        except CookieError:
            pass
        key = cookies.get("workbench_session")
        if (self.headers.get("Host") != workbench.ORIGIN[7:] or not key
                or not secrets.compare_digest(key.value.encode(), self.server.token.encode())):
            self.reply(403, {"error": "请从桌面工作台打开。"})
            return False
        return True

    def end_headers(self):
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def do_GET(self):
        if self.path != "/api/workspace":
            return super().do_GET()
        with LOCK:
            content = STATE.read_bytes() if STATE.exists() else None
            self.reply(200, {"value": content.decode() if content is not None else None,
                             "revision": hashlib.sha256(content).hexdigest() if content is not None else ""})

    def do_POST(self):
        if self.path != "/api/workspace":
            return super().do_POST()
        if self.headers.get("Origin") != workbench.ORIGIN:
            return self.reply(403, {})
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= LIMIT:
                return self.reply(413, {"error": "项目内容超过存储上限。"})
            raw = self.rfile.read(length)
            if not isinstance(json.loads(raw).get("projects"), list):
                raise ValueError
            with LOCK:
                revision = hashlib.sha256(STATE.read_bytes()).hexdigest() if STATE.exists() else ""
                if revision != self.headers.get("X-Workspace-Revision"):
                    return self.reply(409, {"error": "工作区已有更新，请重新打开。"})
                with tempfile.NamedTemporaryFile(dir=DATA, delete=False) as f:
                    f.write(raw)
                Path(f.name).replace(STATE)
            self.reply(200, {"revision": hashlib.sha256(raw).hexdigest()})
        except (ValueError, AttributeError):
            self.reply(400, {"error": "项目格式无效。"})
        except OSError:
            self.reply(500, {"error": "本机保存失败，请检查磁盘空间。"})

    def log_message(self, format, *args):
        pass


def main():
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    workbench.ASSETS["storage.js"] = "text/javascript"
    workbench.execution.ROOT = DATA / "开发产物"
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as http:
        workbench.ORIGIN = f"http://127.0.0.1:{http.server_port}"
        http.token = secrets.token_urlsafe(32)
        print(json.dumps({"port": http.server_port, "token": http.token}), flush=True)
        def watch_parent():
            sys.stdin.buffer.read()
            http.shutdown()
        threading.Thread(target=watch_parent, daemon=True).start()
        http.serve_forever(poll_interval=0.15)


if __name__ == "__main__":
    main()
