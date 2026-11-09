"""Build a local Apple Silicon DMG with a relocatable static CPython 3.12."""
import argparse
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
NAME = "产品创建工作台"
VERSION = "0.1.2"
parser = argparse.ArgumentParser()
parser.add_argument("runtime", type=Path, help="relocatable arm64 CPython 3.12 root")
parser.add_argument("--output", type=Path, default=ROOT / "工作台发布")
args = parser.parse_args()
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
target = out / (f"{NAME}-{VERSION}-macOS-arm64.dmg")

def run(*args):
    subprocess.run(args, check=True)

with tempfile.TemporaryDirectory(dir=out) as tmp:
    work = Path(tmp)
    stage = work / "volume"
    app = stage / (NAME + ".app")
    contents = app / "Contents"
    mac = contents / "MacOS"
    mac.mkdir(parents=True)
    res = contents / "Resources"
    binary = res / "runtime/bin/python3.12"
    binary.parent.mkdir(parents=True)
    shutil.copy2(args.runtime / "bin/python3.12", binary)
    shutil.copytree(args.runtime / "lib/python3.12", res / "runtime/lib/python3.12",
                    ignore=shutil.ignore_patterns("__pycache__", "site-packages", "lib-dynload", "*.pyc"))
    prototype = res / "prototype"
    prototype.mkdir()
    for name in ("index.html", "workbench.css", "project.js", "tasks.js", "workbench.js",
                 "server.py", "connections.py", "execution.py"):
        shutil.copy2(ROOT / "prototype" / name, prototype / name)
    index = prototype / "index.html"
    index.write_text(index.read_text().replace('<script src="project.js">', '<script src="storage.js"></script><script src="project.js">'))
    shutil.copy2(HERE / "storage.js", prototype)
    shutil.copy2(HERE / "service.py", res)
    prompts = Path("upstream/agent-workshop/blueprint/knowledge/prompts")
    (res / prompts).mkdir(parents=True)
    for template in ("chat_intake_ask.md", "chat_intake_summarize.md"):
        shutil.copy2(ROOT / prompts / template, res / prompts)
    for project in ("agent-workshop", "idea-to-launch-kit"):
        folder = res / "upstream" / project
        folder.mkdir(exist_ok=True)
        shutil.copy2(ROOT / "upstream" / project / "LICENSE", folder)

    info = dict(CFBundleIdentifier="local.workbench.ProductWorkbench", CFBundleName=NAME,
                CFBundleDisplayName=NAME, NSPrincipalClass="NSApplication", CFBundlePackageType="APPL",
                CFBundleExecutable="ProductWorkbench", CFBundleVersion="3", CFBundleShortVersionString=VERSION,
                CFBundleIconFile="Workbench.icns", CFBundleDevelopmentRegion="zh_CN",
                LSMinimumSystemVersion="14.0", NSHighResolutionCapable=True)
    (contents / "Info.plist").write_bytes(plistlib.dumps(info))
    run("swift", "-module-cache-path", work / "cache", HERE / "icon.swift", work / "Workbench.iconset")
    run("iconutil", "-c", "icns", work / "Workbench.iconset", "-o", res / "Workbench.icns")
    run("swiftc", "-O", "-module-cache-path", work / "cache", "-target", "arm64-apple-macos14.0",
        HERE / "main.swift", "-o", mac / "ProductWorkbench")
    run("codesign", "--force", "--sign", "-", binary)
    run("codesign", "--force", "--sign", "-", app)
    run("codesign", "--verify", "--deep", "--strict", app)
    (stage / "Applications").symlink_to("/Applications")
    image = work / target.name
    run("hdiutil", "create", "-volname", NAME, "-srcfolder", stage, "-format", "UDZO", image)
    run("hdiutil", "verify", image)
    image.replace(target)
print(target)
