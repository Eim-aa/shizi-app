import Foundation
import WebKit

enum ShiziWebResource {
    static let scheme = "shizi-resource"
    static let host = "app"
}

final class LocalWebSchemeHandler: NSObject, WKURLSchemeHandler {
    private let rootDirectory: URL
    private let standardizedRootPath: String

    init(rootDirectory: URL) {
        self.rootDirectory = rootDirectory.standardizedFileURL
        self.standardizedRootPath = self.rootDirectory.path
        super.init()
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        // B1：数据层端点（/__native/store/v1/<op>，NativeStoreBridge.swift）不是随包文件。
        if let url = urlSchemeTask.request.url, NativeStoreBridge.shared.handles(url) {
            NativeStoreBridge.shared.start(urlSchemeTask)
            return
        }
        guard let requestURL = urlSchemeTask.request.url, let fileURL = fileURL(for: requestURL) else {
            fail(urlSchemeTask, code: NSURLErrorBadURL)
            return
        }

        do {
            let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
            let response = HTTPURLResponse(
                url: requestURL,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: [
                    "Content-Type": contentType(for: fileURL),
                    "Content-Length": String(data.count),
                    "Cache-Control": "no-cache",
                    // 与 index.html 的 CSP meta 逐字相同（01 §8.2；verify_assets.mjs 硬检查两处一致且 script-src 只有 'self'）。
                    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' data:; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-src 'none'; form-action 'none'",
                    "X-Content-Type-Options": "nosniff"
                ]
            ) ?? URLResponse(
                url: requestURL,
                mimeType: mimeType(for: fileURL),
                expectedContentLength: data.count,
                textEncodingName: textEncoding(for: fileURL)
            )
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            fail(urlSchemeTask, code: NSURLErrorFileDoesNotExist)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // WKWebView may cancel in-flight resource loads during navigation. Static files need no cleanup;
        // a stopped data-layer request must not be answered any more.
        NativeStoreBridge.shared.stop(urlSchemeTask)
    }

    private func fileURL(for url: URL) -> URL? {
        guard url.host == ShiziWebResource.host else {
            return nil
        }

        var path = url.path.removingPercentEncoding ?? url.path
        if path == "/" || path.isEmpty {
            path = "/index.html"
        }

        let relativePath = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !relativePath.isEmpty, !relativePath.split(separator: "/").contains("..") else {
            return nil
        }

        let candidate = rootDirectory.appendingPathComponent(relativePath).standardizedFileURL
        guard candidate.path == standardizedRootPath || candidate.path.hasPrefix(standardizedRootPath + "/") else {
            return nil
        }

        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDirectory), !isDirectory.boolValue else {
            return nil
        }

        return candidate
    }

    private func fail(_ task: WKURLSchemeTask, code: Int) {
        let error = NSError(
            domain: NSURLErrorDomain,
            code: code,
            userInfo: [NSLocalizedDescriptionKey: "Unable to load bundled web resource"]
        )
        task.didFailWithError(error)
    }

    private func mimeType(for fileURL: URL) -> String {
        switch fileURL.pathExtension.lowercased() {
        case "html":
            return "text/html"
        case "js", "mjs":
            return "text/javascript"
        case "json", "webmanifest", "map":
            return "application/json"
        case "png":
            return "image/png"
        case "jpg", "jpeg":
            return "image/jpeg"
        case "webp":
            return "image/webp"
        case "css":
            return "text/css"
        case "svg":
            return "image/svg+xml"
        case "woff2":
            return "font/woff2"
        case "woff":
            return "font/woff"
        case "ttf":
            return "font/ttf"
        case "wav":
            return "audio/wav"
        case "caf":
            return "audio/x-caf"
        case "txt":
            return "text/plain"
        case "md":
            return "text/markdown"
        default:
            return "application/octet-stream"
        }
    }

    private func textEncoding(for fileURL: URL) -> String? {
        switch fileURL.pathExtension.lowercased() {
        case "html", "js", "mjs", "json", "webmanifest", "map", "css", "svg", "txt", "md":
            return "utf-8"
        default:
            return nil
        }
    }

    private func contentType(for fileURL: URL) -> String {
        if let encoding = textEncoding(for: fileURL) {
            return "\(mimeType(for: fileURL)); charset=\(encoding)"
        }
        return mimeType(for: fileURL)
    }
}
