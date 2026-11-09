"""Local model connections. Keep the API credential in server memory only."""
import json
import shutil
import subprocess
import threading
from typing import NamedTuple
from uuid import uuid4
from urllib import error, parse, request

CLI = shutil.which("codex") or "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"


class ApiConnection(NamedTuple):
    base: str
    model: str
    key: str


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def api_answer(connection, prompt, fields=None):
    if fields:
        prompt += "\n只输出 JSON 对象；以下字段全部必填，每项值是字符串：" + json.dumps(fields, ensure_ascii=False)
    body = {"model": connection.model, "messages": [{"role": "user", "content": prompt}]}
    req = request.Request(connection.base + "/chat/completions", data=json.dumps(body).encode(),
                          headers={"Authorization": "Bearer " + connection.key, "Content-Type": "application/json"})
    try:
        with request.build_opener(NoRedirect).open(req, timeout=120) as res:
            raw = res.read(2000001)
        if len(raw) > 2000000:
            raise ValueError("模型返回内容过长。")
        answer = json.loads(raw)["choices"][0]["message"]["content"]
        if not isinstance(answer, str) or not answer.strip():
            raise ValueError("模型返回了空内容。")
        answer = answer.strip()
        if fields:
            if answer.startswith("```") and answer.endswith("```"):
                answer = answer.partition("\n")[2][:-3].strip()
            obj = json.loads(answer)
            if not isinstance(obj, dict) or not all(isinstance(obj.get(k), str) and obj[k].strip() for k in fields):
                raise ValueError("模型未按要求返回完整文档。")
        return answer
    except error.HTTPError as exc:
        raise ValueError(f"模型服务返回 HTTP {exc.code}，请核对地址、模型、密钥和额度。") from None
    except (OSError, error.URLError):
        raise ValueError("无法连接模型服务，请检查地址和网络。") from None
    except (KeyError, IndexError, TypeError, json.JSONDecodeError):
        raise ValueError("模型响应格式不兼容，请使用 Chat Completions 兼容接口。") from None


class Connections:
    def __init__(self):
        self.lock = threading.Lock()
        self.profiles = {}
        self.last_id = None
        self.selected = "codex"
        self.login_process = None

    def active(self):
        with self.lock:
            return self.profiles.get(self.last_id) if self.selected == "api" else None

    def status(self):
        with self.lock:
            return self._status()

    def _status(self):
        last = self.profiles.get(self.last_id)
        return {"selected": self.selected, "connectionId": self.last_id,
                "model": last.model if last else "", "base": last.base if last else "",
                "profiles": [{"id": ident, "base": entry.base, "model": entry.model}
                             for ident, entry in self.profiles.items()]}

    def configure(self, data):
        base, model, key = (str(data.get(f) or "").strip() for f in ("base", "model", "key"))
        url = parse.urlsplit(base)
        local = url.hostname in ("localhost", "127.0.0.1", "::1")
        if not url.hostname or url.username or url.password or url.query or url.fragment or not (
                url.scheme == "https" or (local and url.scheme == "http")):
            raise ValueError("请输入 HTTPS 服务根地址，本机服务也支持 HTTP。")
        if not model or not key or any(ch in key for ch in "\r\n"):
            raise ValueError("请填写模型 ID 和有效的 API Key。")
        candidate = ApiConnection(base.rstrip("/"), model, key)
        api_answer(candidate, "连接验证，只回答 OK。")
        with self.lock:
            ident = next((k for k, v in self.profiles.items() if v == candidate), None)
            if ident is None:
                ident = uuid4().hex
                self.profiles[ident] = candidate
            self.last_id = ident
            self.selected = "api"
            return self._status()

    def select(self, mode, ident=None):
        with self.lock:
            if mode == "api":
                ident = self.last_id if ident is None else ident
                if not isinstance(ident, str) or ident not in self.profiles:
                    raise ValueError("这项连接已失效，请重新接入。")
                self.last_id = ident
            elif mode != "codex":
                raise ValueError("请先测试并连接模型。")
            self.selected = mode
            return self._status()

    def login(self, start):
        try:
            result = subprocess.run([CLI, "login", "status"], capture_output=True, timeout=8)
            signed = result.returncode == 0
            with self.lock:
                process = self.login_process
                if start and not signed and (not process or process.poll() is not None):
                    process = self.login_process = subprocess.Popen([CLI, "login"], stdin=subprocess.DEVNULL,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                pending = bool(process and process.poll() is None)
                failed = bool(process and process.poll() not in (None, 0))
            return {"signed": signed, "pending": pending, "failed": failed and not signed}
        except OSError:
            raise ValueError("未找到可用的 Codex CLI，请先安装 Codex。") from None
