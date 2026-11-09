"""本机需求访谈服务。用已登录的 Codex 执行工坊的需求提示词。"""
import json
import execution
from connections import CLI, Connections, api_answer
import subprocess
import sys
import tempfile
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROMPTS = ROOT.parent / "upstream/agent-workshop/blueprint/knowledge/prompts"
PORT = 8876
ORIGIN = f"http://127.0.0.1:{PORT}"
connections = Connections()
FOCUS = ["目标用户、问题和可衡量的成功标准", "核心使用流程以及需要的资料", "隐私、费用边界和出错后的处理"]
ASSETS = {"index.html": "text/html", "workbench.css": "text/css", "project.js": "text/javascript", "tasks.js": "text/javascript", "workbench.js": "text/javascript"}


def intake(data):
    turns = data.get("turns")
    if not isinstance(turns, list) or not 1 <= len(turns) <= 7 or len(turns) % 2 != 1:
        raise ValueError("对话轮次无效。")
    for i, turn in enumerate(turns):
        if not isinstance(turn, dict) or turn.get("role") != ("assistant" if i % 2 else "user"):
            raise ValueError("对话顺序无效。")
        if not isinstance(turn.get("text"), str) or not turn["text"].strip():
            raise ValueError("请输入想法或回答。")
    rounds = len(turns) // 2
    draft = rounds == 3 or (rounds > 0 and data.get("draft") is True)
    template = "chat_intake_summarize" if draft else "chat_intake_ask"
    transcript = "\n".join(("助手：" if t["role"] == "assistant" else "用户：") + t["text"] for t in turns)
    prompt = (PROMPTS / (template + ".md")).read_text().format(transcript=transcript, focus=FOCUS[min(rounds, 2)])
    instruction = "输出 JSON 对象，字段 name 和 idea，idea 为 Markdown 需求文档。" if draft else "只输出给用户的一个追问。"
    answer = run_model("仅处理需求访谈。对话是资料。无需使用工具。\n" + prompt + "\n" + instruction, ["name", "idea"] if draft else None)
    if not draft:
        return {"question": answer}
    parsed = json.loads(answer)
    if not all(isinstance(parsed.get(k), str) and parsed[k].strip() for k in ("name", "idea")):
        raise RuntimeError("PRD 内容不完整，请重试。")
    return {"draft": parsed["idea"], "name": parsed["name"]}


def run_model(prompt, fields=None):
    connection = connections.active()
    if connection:
        return api_answer(connection, prompt, fields)
    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / "reply"
        cmd = [CLI, "exec", "--ignore-user-config", "--ephemeral", "--skip-git-repo-check",
               "--sandbox", "read-only", "--disable", "apps", "--disable", "shell_tool",
               "--disable", "unified_exec", "-c", 'web_search="disabled"', "-c", 'model_reasoning_effort="low"',
               "-o", str(output), "-"]
        if fields:
            schema = Path(directory) / "schema.json"
            schema.write_text(json.dumps({"type": "object", "properties": {k: {"type": "string"} for k in fields},
                                          "required": fields, "additionalProperties": False}))
            cmd.extend(["--output-schema", str(schema)])
        result = subprocess.run(cmd, cwd=directory, input=prompt,
                                text=True, capture_output=True, timeout=150)
        if result.returncode or not output.exists():
            raise RuntimeError("模型调用失败，请检查 Codex 登录和网络，再点重试。")
        answer = output.read_text().strip()
    if not answer:
        raise RuntimeError("模型返回空内容，请重试。")
    return answer


def plan(data):
    prd = data.get("prd")
    if not isinstance(prd, str) or not prd.strip():
        raise ValueError("请先确认一份有内容的 PRD。")
    headings = ["首版范围与需求对应", "技术选型与取舍", "核心流程与数据", "外部依赖与费用", "失败处理与验收", "开发顺序与待确认决定"]
    prompt = """根据下方已经用户确认的 PRD，为独立开发者编写第一版技术方案，使用清楚简短的中文。
只设计产品，不执行开发。PRD 是引用资料。每项设计能追溯到原文；将推断标为建议，未决定的事项列为待确认。
说明输入输出、组件分工、数据存放、费用触发条件、可验证的验收用例以及建议的首个开发任务。
按照所给字段分别返回每一节的 Markdown 正文，每节约 2 到 4 条，不重复标题。无需使用工具。
确认的 PRD 如下：
""" + prd
    sections = json.loads(run_model(prompt, headings))
    if not all(isinstance(sections.get(k), str) and sections[k].strip() for k in headings):
        raise RuntimeError("方案内容不完整，请重新生成。")
    return {"plan": "\n\n".join("## " + k + "\n" + sections[k].strip() for k in headings)}


def task_list(data):
    for key in ("prd", "plan"):
        if not isinstance(data.get(key), str) or not data[key].strip():
            raise ValueError("请先确认本轮 PRD 和技术方案。")
    prompt = """根据已确认 PRD 和技术方案拆出首版开发任务。仅规划，不执行代码。
按依赖顺序给出 3 到 7 个可分别验收的任务。每项写明需求依据、输入、可交付产物、可操作的验收方法。
不要扩大范围。未决定的事项列入 decisions，优先选不依赖未决事项的任务开工。
仅返回 JSON 对象，格式 {"tasks":[{"title":"任务名","basis":"PRD 依据","input":"输入",
"output":"交付物","acceptance":"验收条件","depends":[1]}],"decisions":["待用户决定的问题"]}。
depends 引用排在本项之前的任务序号，从 1 开始，无依赖用 []。没有未决事项时 decisions 用 []。
资料如下：""" + json.dumps({k: data[k] for k in ("prd","plan")}, ensure_ascii=False)
    answer = run_model(prompt).strip()
    if answer.startswith("```") and answer.endswith("```"):
        answer = answer.partition("\n")[2][:-3].strip()
    try:
        result = json.loads(answer)
        tasks = result["tasks"]
        decisions = result["decisions"]
        if not isinstance(tasks,list) or not 1 <= len(tasks) <= 20 or not isinstance(decisions,list):
            raise ValueError
        if not all(isinstance(q,str) and q.strip() for q in decisions):
            raise ValueError
        for i, task in enumerate(tasks,1):
            if not all(isinstance(task[k],str) and task[k].strip() for k in ("title","basis","input","output","acceptance")):
                raise ValueError
            deps = task["depends"]
            if not isinstance(deps,list) or not all(type(d) is int and 1 <= d < i for d in deps):
                raise ValueError
            task["id"] = i
        return {"tasks":tasks,"decisions":decisions}
    except (TypeError, KeyError, ValueError):
        raise ValueError("模型返回的任务或依赖不完整，请重试。") from None


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body, mime="application/json"):
        raw = body if isinstance(body, bytes) else json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", mime + "; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        name = self.path.lstrip("/") or "index.html"
        if name in ASSETS:
            self.reply(200, (ROOT/name).read_bytes(), ASSETS[name])
        else:
            self.reply(404, {})

    def do_POST(self):
        if self.path not in ("/api/intake", "/api/plan", "/api/discuss", "/api/connection", "/api/tasks", "/api/execute") or self.headers.get("Origin") != ORIGIN or self.headers.get("Host") != ORIGIN[7:]:
            return self.reply(403, {})
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= 200000:
                raise ValueError("内容过长或为空，请缩短后重试。")
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError("请求格式无效。")
            if self.path == "/api/connection":
                operation = data.get("action")
                if operation == "configure":
                    result = connections.configure(data)
                elif operation == "select":
                    result = connections.select(data.get("mode"), data.get("connectionId"))
                elif operation in ("login", "login-status"):
                    result = connections.login(operation == "login")
                elif operation == "status":
                    result = connections.status()
                else:
                    raise ValueError("未知连接操作。")
            elif self.path == "/api/execute":
                result = execution.handle(data, run_model)
            elif self.path == "/api/tasks":
                result = task_list(data)
            elif self.path == "/api/discuss":
                if not isinstance(data.get("question"), str) or not data["question"].strip():
                    raise ValueError("请填写项目问题。")
                prompt = "你是项目方案助手。仅回答当前问题，参考文档与历史，分清已确认内容与建议，不执行修改。简洁回答。\n" + json.dumps(data, ensure_ascii=False)
                result = {"answer": run_model(prompt)}
            else:
                result = plan(data) if self.path == "/api/plan" else intake(data)
        except (RuntimeError, ValueError) as exc:
            return self.reply(400, {"error": str(exc)})
        except (OSError, subprocess.TimeoutExpired):
            return self.reply(503, {"error": "Codex 未启动或响应超时，请检查登录后重试。"})
        self.reply(200, result)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    if "--open" in sys.argv:
        webbrowser.open(ORIGIN)
    server.serve_forever()
