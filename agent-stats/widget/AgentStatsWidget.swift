// Agent Stats as a desktop widget: a borderless window on the desktop layer that shows widget.tsx in a WKWebView.
// The shell owns the settings (right-click menu, saved in UserDefaults), fetches the numbers from
// `bb agent-stats show --json` and pushes them to the page with window.widget.set().
import AppKit
import ServiceManagement
import WebKit

let THEMES = [("sunset", "Закат"), ("grain", "Зерно"), ("pixels", "Пиксели"), ("acid", "Кислота"), ("neural", "Нейросеть"), ("swirl", "Воронка")]
let PERIODS = [("24h", "24 часа"), ("7", "7 дней"), ("14", "14 дней"), ("30", "30 дней"), ("90", "90 дней")]
let SOURCES = [("bb", "Треды BB"), ("all", "Все сессии Claude Code и Codex")]
let SIZES: [(String, String, NSSize)] = [
  ("small", "Маленький", NSSize(width: 170, height: 170)),
  ("medium", "Средний", NSSize(width: 364, height: 170)),
  ("large", "Большой", NSSize(width: 364, height: 382)),
]
let REFRESH_SECONDS: TimeInterval = 300

/** The page never takes the mouse: clicks fall through to the container, which drags the window and opens the menu. */
final class PassthroughWebView: WKWebView {
  override func hitTest(_ point: NSPoint) -> NSView? { nil }
}

final class Container: NSView {
  var makeMenu: (() -> NSMenu)?
  override func menu(for event: NSEvent) -> NSMenu? { makeMenu?() }
  override func mouseDown(with event: NSEvent) { window?.performDrag(with: event) }
}

final class Widget: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler {
  let defaults = UserDefaults.standard
  var window: NSWindow!
  var web: PassthroughWebView!
  var timer: Timer?
  var generation = 0
  var loaded = false

  var theme: String { get { defaults.string(forKey: "theme") ?? "sunset" } set { defaults.set(newValue, forKey: "theme") } }
  var period: String { get { defaults.string(forKey: "period") ?? "7" } set { defaults.set(newValue, forKey: "period") } }
  var source: String { get { defaults.string(forKey: "source") ?? "bb" } set { defaults.set(newValue, forKey: "source") } }
  var size: String { get { defaults.string(forKey: "size") ?? "medium" } set { defaults.set(newValue, forKey: "size") } }
  var animated: Bool {
    get { defaults.object(forKey: "animated") as? Bool ?? !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
    set { defaults.set(newValue, forKey: "animated") }
  }
  var onTop: Bool { get { defaults.bool(forKey: "onTop") } set { defaults.set(newValue, forKey: "onTop") } }
  /** How to call bb; another Mac can read its bb server's stats with e.g. `ssh <host> /path/to/bb`. */
  var cli: String { defaults.string(forKey: "cli") ?? "bb" }

  var pixelSize: NSSize { SIZES.first { $0.0 == size }?.2 ?? SIZES[1].2 }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let frame = NSRect(origin: savedOrigin(), size: pixelSize)
    window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
    window.isOpaque = false
    window.backgroundColor = .clear
    window.hasShadow = true
    window.isReleasedWhenClosed = false
    window.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
    window.delegate = self
    applyLevel()

    let container = Container(frame: NSRect(origin: .zero, size: frame.size))
    container.autoresizingMask = [.width, .height]
    container.makeMenu = { [unowned self] in menu() }
    // Page errors go to the app's stderr (Console.app), since the widget has no inspector open.
    let config = WKWebViewConfiguration()
    config.userContentController.add(self, name: "log")
    config.userContentController.addUserScript(WKUserScript(source: """
      addEventListener("error", (e) => webkit.messageHandlers.log.postMessage(`${e.message} at ${e.filename}:${e.lineno}`));
      addEventListener("unhandledrejection", (e) => webkit.messageHandlers.log.postMessage(String(e.reason)));
      """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    web = PassthroughWebView(frame: container.bounds, configuration: config)
    web.autoresizingMask = [.width, .height]
    web.setValue(false, forKey: "drawsBackground")
    web.underPageBackgroundColor = .clear
    web.navigationDelegate = self
    container.addSubview(web)
    window.contentView = container

    let resources = Bundle.main.resourceURL!
    web.loadFileURL(resources.appendingPathComponent("index.html"), allowingReadAccessTo: resources)

    NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: window, queue: .main) { [unowned self] _ in pushLook() }
    NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { [unowned self] _ in refresh() }
    timer = Timer.scheduledTimer(withTimeInterval: REFRESH_SECONDS, repeats: true) { [unowned self] _ in refresh() }
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loaded = true
    pushLook()
    refresh()
    // Let the first frame paint before the window appears, so the default theme never flashes.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [self] in
      window.orderFrontRegardless()
      window.invalidateShadow()
    }
  }

  // ---- Page ----

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
    NSLog("page: %@", String(describing: message.body))
  }

  func push(_ json: String) {
    guard loaded else { return }
    web.evaluateJavaScript("window.widget.set(\(json))")
  }

  func pushLook() {
    let visible = window.occlusionState.contains(.visible)
    push(#"{"theme":"\#(theme)","size":"\#(size)","animated":\#(animated && visible)}"#)
  }

  // ---- Data ----

  func refresh() {
    generation += 1
    let current = generation
    push(#"{"loading":true}"#)
    let range = period == "24h" ? "--hours 24" : "--days \(period)"
    let command = "\(cli) agent-stats show --json --source \(source) \(range)"
    DispatchQueue.global(qos: .utility).async { [self] in
      let result = run(command)
      DispatchQueue.main.async { [self] in
        guard current == generation else { return }
        switch result {
        case .success(let stats): push(#"{"stats":\#(stats),"loading":false,"error":null}"#)
        case .failure(let message): push(#"{"loading":false,"error":\#(jsonString(message))}"#)
        }
      }
    }
  }

  enum Fetch { case success(String), failure(String) }

  /** Runs the CLI through a login shell, so bb and its runtime are on PATH as in Terminal. */
  func run(_ command: String) -> Fetch {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = ["-lc", command]
    let out = Pipe(), err = Pipe()
    process.standardOutput = out
    process.standardError = err
    do { try process.run() } catch { return .failure("Не запускается zsh: \(error.localizedDescription)") }
    let data = out.fileHandleForReading.readDataToEndOfFile()
    let errData = err.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    let text = String(decoding: data, as: UTF8.self)
    // A login shell may print its own lines first: the stats are the line that parses as JSON.
    if process.terminationStatus == 0,
       let line = text.split(separator: "\n").last(where: { $0.hasPrefix("{") }),
       (try? JSONSerialization.jsonObject(with: Data(line.utf8))) != nil {
      return .success(String(line))
    }
    let reason = String(decoding: errData, as: UTF8.self).split(separator: "\n").last.map(String.init)
      ?? "bb agent-stats завершился с кодом \(process.terminationStatus)"
    return .failure(String(reason.prefix(140)))
  }

  func jsonString(_ s: String) -> String {
    let data = try! JSONSerialization.data(withJSONObject: [s])
    return String(decoding: data, as: UTF8.self).dropFirst().dropLast().description
  }

  // ---- Window ----

  func savedOrigin() -> NSPoint {
    // A saved spot on a display that is gone now would leave the widget off-screen.
    if let s = defaults.string(forKey: "origin"), NSScreen.screens.contains(where: { $0.frame.contains(NSPointFromString(s)) }) {
      return NSPointFromString(s)
    }
    let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
    return NSPoint(x: screen.maxX - pixelSize.width - 24, y: screen.maxY - pixelSize.height - 24)
  }

  func windowDidMove(_ notification: Notification) {
    defaults.set(NSStringFromPoint(window.frame.origin), forKey: "origin")
  }

  func applyLevel() {
    window.level = onTop ? .floating : NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
  }

  /** A new size keeps the widget's top-left corner where it was. */
  func applySize() {
    let top = window.frame.maxY
    let s = pixelSize
    window.setFrame(NSRect(x: window.frame.minX, y: top - s.height, width: s.width, height: s.height), display: true)
    pushLook()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { self.window.invalidateShadow() }
  }

  // ---- Menu ----

  func menu() -> NSMenu {
    let menu = NSMenu()
    menu.addItem(item("Обновить", #selector(refreshNow)))
    menu.addItem(.separator())
    menu.addItem(submenu("Тема", THEMES, current: theme, #selector(pickTheme(_:))))
    menu.addItem(submenu("Период", PERIODS, current: period, #selector(pickPeriod(_:))))
    menu.addItem(submenu("Источник", SOURCES, current: source, #selector(pickSource(_:))))
    menu.addItem(submenu("Размер", SIZES.map { ($0.0, $0.1) }, current: size, #selector(pickSize(_:))))
    menu.addItem(.separator())
    menu.addItem(item("Анимировать фон", #selector(toggleAnimated), on: animated))
    menu.addItem(item("Поверх всех окон", #selector(toggleOnTop), on: onTop))
    menu.addItem(item("Запускать при входе", #selector(toggleLogin), on: SMAppService.mainApp.status == .enabled))
    menu.addItem(.separator())
    menu.addItem(item("Закрыть виджет", #selector(quit)))
    return menu
  }

  func item(_ title: String, _ action: Selector, on: Bool = false) -> NSMenuItem {
    let i = NSMenuItem(title: title, action: action, keyEquivalent: "")
    i.target = self
    i.state = on ? .on : .off
    return i
  }

  func submenu(_ title: String, _ options: [(String, String)], current: String, _ action: Selector) -> NSMenuItem {
    let parent = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    let sub = NSMenu()
    for (key, name) in options {
      let i = item(name, action, on: key == current)
      i.representedObject = key
      sub.addItem(i)
    }
    parent.submenu = sub
    return parent
  }

  @objc func refreshNow() { refresh() }
  @objc func pickTheme(_ sender: NSMenuItem) { theme = sender.representedObject as! String; pushLook() }
  @objc func pickPeriod(_ sender: NSMenuItem) { period = sender.representedObject as! String; refresh() }
  @objc func pickSource(_ sender: NSMenuItem) { source = sender.representedObject as! String; refresh() }
  @objc func pickSize(_ sender: NSMenuItem) { size = sender.representedObject as! String; applySize() }
  @objc func toggleAnimated() { animated.toggle(); pushLook() }
  @objc func toggleOnTop() { onTop.toggle(); applyLevel() }
  @objc func quit() { NSApp.terminate(nil) }

  @objc func toggleLogin() {
    do {
      if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() } else { try SMAppService.mainApp.register() }
    } catch {
      let alert = NSAlert()
      alert.messageText = "Не получилось изменить автозапуск"
      alert.informativeText = error.localizedDescription
      alert.runModal()
    }
  }
}

let app = NSApplication.shared
let delegate = Widget()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
