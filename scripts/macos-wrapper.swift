import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var childProcesses: [Process] = []
    private var logHandle: FileHandle?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit Startup Idea Tracker", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        menu.addItem(appItem)
        NSApplication.shared.mainMenu = menu
        startServer()

        let configuration = WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self

        window = NSWindow(
            contentRect: NSMakeRect(0, 0, 1280, 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Startup Idea Tracker"
        window.minSize = NSSize(width: 960, height: 640)
        window.contentView = webView
        window.center()
        window.makeKeyAndOrderFront(nil)

        waitForServer(attempt: 0)
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        childProcesses.filter { $0.isRunning }.forEach { $0.terminate() }
        let deadline = Date().addingTimeInterval(2)
        while childProcesses.contains(where: { $0.isRunning }) && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        try? logHandle?.close()
        return .terminateNow
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        alert.beginSheetModal(for: window) { completionHandler($0 == .alertFirstButtonReturn) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url,
           ["http", "https"].contains(url.scheme ?? ""),
           !["127.0.0.1", "localhost", "::1"].contains(url.host ?? "") {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["http", "https"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        return nil
    }

    private func startServer() {
        guard let runtimeRoot = Bundle.main.resourceURL?.appendingPathComponent("app").path else { return }
        let supportRoot = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Startup Idea Tracker")
        try? FileManager.default.createDirectory(at: supportRoot, withIntermediateDirectories: true)
        let logPath = (NSHomeDirectory() as NSString).appendingPathComponent("Library/Logs/Startup Idea Tracker.log")
        let logURL = URL(fileURLWithPath: logPath)
        FileManager.default.createFile(atPath: logPath, contents: nil)
        logHandle = try? FileHandle(forWritingTo: logURL)
        logHandle?.seekToEndOfFile()

        let nodePath = "/opt/homebrew/bin/node"
        var environment = ProcessInfo.processInfo.environment
        environment["APP_DB_PATH"] = supportRoot.appendingPathComponent("app.sqlite").path
        environment["NODE_ENV"] = "production"
        environment["NODE_DISABLE_COMPILE_CACHE"] = "1"
        environment["HOME"] = NSHomeDirectory()
        environment["PATH"] = "\(NSHomeDirectory())/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        let processes: [([String], String)] = [
            (["\(runtimeRoot)/server.mjs"], runtimeRoot),
            (["\(runtimeRoot)/proxy.cjs"], runtimeRoot)
        ]
        for (arguments, directory) in processes {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: nodePath)
            process.arguments = arguments
            process.currentDirectoryURL = URL(fileURLWithPath: directory)
            var processEnvironment = environment
            processEnvironment["PWD"] = directory
            process.environment = processEnvironment
            process.standardInput = FileHandle.nullDevice
            process.standardOutput = logHandle
            process.standardError = logHandle
            try? process.run()
            childProcesses.append(process)
        }
    }

    private func waitForServer(attempt: Int) {
        let request = URLRequest(url: URL(string: "http://127.0.0.1:3334/api/health")!, timeoutInterval: 1.0)
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            guard let self else { return }
            DispatchQueue.main.async {
                if (response as? HTTPURLResponse)?.statusCode == 200 || attempt >= 300 {
                    self.webView.load(URLRequest(url: URL(string: "http://127.0.0.1:3334")!))
                } else {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        self.waitForServer(attempt: attempt + 1)
                    }
                }
            }
        }.resume()
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.activate(ignoringOtherApps: true)
application.run()
