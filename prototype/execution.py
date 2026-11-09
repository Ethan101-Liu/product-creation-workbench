"""Run one confirmed task at a time. Each attempt has a separate output directory."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from threading import Lock, Thread
import time
from uuid import UUID

ROOT = Path(__file__).resolve().parent.parent / "开发产物"
LOCK = Lock()
RUNNING = set()


def store(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2))
    temporary.replace(path)


def run_checks(folder):
    # Only the Python runtime and this disposable copy are readable. No network or child processes.
    with tempfile.TemporaryDirectory() as temp:
        work = Path(temp).resolve() / "work"
        shutil.copytree(folder, work)
        runtime = Path(sys.base_prefix).resolve()
        binary = runtime / "Resources/Python.app/Contents/MacOS/Python"
        if not binary.is_file():
            binary = Path(sys.executable).resolve()
        read = ["/System", "/usr/lib", "/usr/share", "/Library/Apple", str(runtime),
                str(Path(sys.executable).resolve().parent.parent), str(work), "/dev/null", "/dev/urandom"]
        profile = ("(version 1)(deny default)(import \"dyld-support.sb\")(allow process-exec (literal " +
                   json.dumps(str(binary), ensure_ascii=False) + "))"
                   "(allow sysctl-read)(allow file-read-metadata)(allow file-read* " +
                   " ".join("(subpath " + json.dumps(p, ensure_ascii=False) + ")" for p in read) +
                   ")(allow file-map-executable " + " ".join("(subpath " + json.dumps(p, ensure_ascii=False) + ")" for p in read if p != str(work)) + ")(allow file-write* (subpath " + json.dumps(str(work), ensure_ascii=False) + "))")
        bootstrap = """import resource,sys,unittest
resource.setrlimit(resource.RLIMIT_FSIZE,(262144,262144))
resource.setrlimit(resource.RLIMIT_CPU,(12,12))
suite=unittest.defaultTestLoader.discover('.',pattern='test_*.py')
result=unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(0 if result.testsRun and result.testsRun>len(result.skipped) and result.wasSuccessful() else 1)
"""
        path = Path(temp) / "test.log"
        start = time.monotonic()
        with path.open("wb") as output:
            try:
                result = subprocess.run(["/usr/bin/sandbox-exec", "-p", profile, str(binary),
                                         "-I", "-B", "-c", bootstrap], cwd=work, env={"PATH":"/usr/bin:/bin","HOME":str(work),"TMPDIR":str(work)},
                                        stdout=output, stderr=subprocess.STDOUT, timeout=20)
                code = result.returncode
            except subprocess.TimeoutExpired:
                code = 124
        return {"exitCode":code,"seconds":round(time.monotonic()-start,2),"log":path.read_bytes()[-16000:].decode(errors="replace")}


def develop(path, snapshot, model):
    index = snapshot["index"]
    attempt = path.parent / ("task-%02d-attempt-%02d" % (index+1,snapshot["attempt"]))
    files = attempt / "files"
    report = {"folder":str(attempt),"files":[]}
    try:
        attempt.mkdir()
        previous = snapshot["accepted"]
        if previous:
            shutil.copytree(Path(previous[-1]["folder"]) / "files", files)
        else:
            files.mkdir()
        source = {f.name:f.read_text() for f in files.iterdir()}
        inputs = snapshot["inputs"]
        task = inputs["tasks"][index]
        material = dict(prd=inputs["prd"],plan=inputs["plan"],decisions=inputs["decisions"],
                        task=task,approved_files=source,feedback=snapshot.get("feedback",""))
        prompt = """你是单项开发执行器。只完成指定任务，按已确认的需求与决定交付实际文件；不要推进下一项。
运行环境是离线 Python 标准库和 SQLite；测试由独立运行器在临时副本上运行 unittest。
若任务是文档，交付具体 Markdown/JSON 文档或用例，测试实际读取并核验文档结构及关键要求；
若任务是实现，交付可运行模块，并对真实函数、持久化或失败行为做具体断言。
测试类、测试方法和模块遵循 unittest 发现规则。不能用无条件通过或模拟未执行结果代替测试。
沿用之前通过验收的文件，保留原有测试，新测试使用独立文件名。不要宣称已通过测试或已验证真实设备。
若必要平台或依赖不可用，返回 blocked 说明具体原因。仅输出 JSON 对象，blocked 为空表示已生成，
files 为新增或修改的完整文件，键为简单英文文件名（.py/.md/.json），值为文件完整文本。示例：
{"blocked":"","files":{"cases.md":"...","test_cases.py":"..."}}。输入资料如下：\n"""
        raw = model(prompt+json.dumps(material,ensure_ascii=False)).strip()
        if raw.startswith("```") and raw.endswith("```"):
            raw = raw.partition("\n")[2][:-3]
        response = json.loads(raw)
        if response.get("blocked"):
            raise ValueError(str(response["blocked"]))
        changes = response["files"]
        if not isinstance(changes,dict) or not 1 <= len(changes) <= 30:
            raise ValueError("未收到可验收的文件。")
        for name, content in changes.items():
            if not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]{0,80}\.(py|md|json)",name) or not isinstance(content,str) or not content.strip():
                raise ValueError("交付文件名或内容无效。")
        if not any(name.startswith("test_") and name.endswith(".py") for name in changes):
            raise ValueError("本次交付缺少当前任务的验收测试。")
        for name, content in changes.items():
            (files/name).write_text(content)
        report["files"]=list(changes)
        report.update(run_checks(files))
        status="review" if report["exitCode"]==0 else "failed"
    except Exception as exc:
        report["error"]=str(exc)[:3000]
        status="failed"
    with LOCK:
        try:
            store(attempt/"evidence.json",report)
            snapshot.update(status=status,result=report)
            store(path,snapshot)
        finally:
            RUNNING.discard(path)


def handle(data, model):
    run_id=str(UUID(str(data.get("id",""))))
    path=ROOT/run_id/"run.json"
    with LOCK:
        if not path.exists():
            if data.get("action")=="status":
                return {"status":"new","index":0,"accepted":[]}
            inputs=data.get("inputs",{})
            tasks=inputs.get("tasks")
            if data.get("action")!="start" or not inputs.get("confirmed") or not isinstance(tasks,list) or not tasks:
                raise ValueError("请先确认开发任务清单。")
            if not all(isinstance(inputs.get(k),str) and inputs[k].strip() for k in ("prd","plan")):
                raise ValueError("缺少已确认的需求或方案。")
            path.parent.mkdir(parents=True,exist_ok=True)
            state={"inputs":inputs,"index":0,"attempt":0,"accepted":[],"status":"new"}
        else:
            state=json.loads(path.read_text())
        if state["status"]=="running" and path not in RUNNING:
            state.update(status="failed",result={"error":"服务已中断，请重新执行本项。"})
            store(path,state)
        op=data.get("action")
        if op=="artifact":
            report=state.get("result",{})
            name=data.get("name")
            if state["status"] not in ("review","failed") or name not in report.get("files",[]) or data.get("attempt")!=state["attempt"]:
                raise ValueError("该文件不属于本次可查看的产物。")
            return {"content":(Path(report["folder"])/"files"/name).read_text()}
        if op!="status" and data.get("index")!=state["index"]:
            raise ValueError("任务位置已更新，请刷新页面。")
        if op=="approve" and state["status"]=="review":
            result=state.pop("result")
            state["accepted"].append(result)
            state["index"]+=1
            state.update(status="complete" if state["index"]==len(state["inputs"]["tasks"]) else "ready",attempt=0)
            store(path,state)
        elif op=="start" and state["status"] in ("new","ready","failed","review"):
            if data.get("attempt",0)!=state["attempt"]:
                raise ValueError("执行记录已更新，请刷新。")
            state.update(status="running",attempt=state["attempt"]+1,feedback=str(data.get("feedback",""))[:4000])
            state.pop("result",None)
            store(path,state)
            RUNNING.add(path)
            Thread(target=develop,args=(path,dict(state),model),daemon=True).start()
        elif op not in ("start","status","approve"):
            raise ValueError("未知执行操作。")
        return {k:v for k,v in state.items() if k!="inputs"}
