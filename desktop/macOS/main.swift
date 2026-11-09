import AppKit
import WebKit

struct Session: Decodable {
    let port: Int
    let token: String
}

final class WorkbenchApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private var window: NSWindow!
    private var web: WKWebView!
    private let service = Process()
    private let lifetime = Pipe()
    private var port: Int?
    private var quitting = false

    func applicationDidFinishLaunching(_ notice: Notification) {
        let menu = NSMenu()
        let appItem = menu.addItem(withTitle: "产品创建工作台", action: nil, keyEquivalent: "")
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "退出产品创建工作台", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        let editItem = menu.addItem(withTitle: "编辑", action: nil, keyEquivalent: "")
        let edits = NSMenu(title: "编辑")
        for (name, selector, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            edits.addItem(withTitle: name, action: Selector(selector), keyEquivalent: key)
        }
        editItem.submenu = edits
        NSApp.mainMenu = menu
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "exportDocument")
        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1240, height: 780),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "产品创建工作台"
        window.minSize = NSSize(width: 680, height: 440)
        window.contentView = web
        window.center()
        window.setFrameAutosaveName("ProductWorkbenchWindow")
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        startService()
    }

    private func startService() {
        let resources = Bundle.main.resourceURL!
        let output = Pipe()
        service.executableURL = resources.appendingPathComponent("runtime/bin/python3.12")
        service.arguments = ["-I", "-B", resources.appendingPathComponent("service.py").path]
        service.standardInput = lifetime
        service.standardOutput = output
        service.environment = ["PATH": NSHomeDirectory() + "/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
                               "HOME": NSHomeDirectory(), "SSL_CERT_FILE": "/etc/ssl/cert.pem"]
        service.terminationHandler = { [weak self] _ in DispatchQueue.main.async {
            guard let self = self, !self.quitting else { return }
            self.showError("本机工作台服务已关闭。请退出后重新打开应用。")
        }}
        do { try service.run() } catch {
            showError("本机工作台服务无法启动，请重新安装应用。")
            return
        }
        DispatchQueue.global().async {
            var line = Data()
            while line.count < 4096 && !line.contains(10) {
                let bytes = output.fileHandleForReading.availableData
                if bytes.isEmpty { break }
                line.append(bytes)
            }
            guard let session = try? JSONDecoder().decode(Session.self, from: line) else { return }
            DispatchQueue.main.async { self.connect(session) }
        }
    }

    private func connect(_ session: Session) {
        guard !quitting, let url = URL(string: "http://127.0.0.1:\(session.port)/"),
              let cookie = HTTPCookie(properties: [.domain: "127.0.0.1", .path: "/", .name: "workbench_session",
                                                    .value: session.token, .discard: "TRUE"]) else { return }
        port = session.port
        web.configuration.websiteDataStore.httpCookieStore.setCookie(cookie) {
            self.web.load(URLRequest(url: url))
        }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let url = action.request.url
        decisionHandler(url?.scheme == "http" && url?.host == "127.0.0.1" && url?.port == port ? .allow : .cancel)
    }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.host == "127.0.0.1", origin.port == port,
              let fields = message.body as? [String: String], let text = fields["text"],
              let filename = fields["filename"] else { return }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = (filename as NSString).lastPathComponent
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window) { result in
            guard result == .OK, let url = panel.url else { return }
            do { try text.write(to: url, atomically: true, encoding: .utf8) }
            catch { self.showError("文档保存失败。" + error.localizedDescription) }
        }
    }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let alert = NSAlert()
        alert.messageText = prompt
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.window.initialFirstResponder = field
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { result in
            completionHandler(result == .alertFirstButtonReturn ? field.stringValue : nil)
        }
    }
    private func showError(_ reason: String) {
        let alert = NSAlert()
        alert.messageText = "产品创建工作台"
        alert.informativeText = reason
        alert.beginSheetModal(for: window)
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notice: Notification) {
        quitting = true
        try? lifetime.fileHandleForWriting.close()
        if service.isRunning { service.terminate() }
    }
}
let app = NSApplication.shared
let delegate = WorkbenchApp()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
