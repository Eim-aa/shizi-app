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
                    "Cache-Control": "no-cache"
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
        // WKWebView may cancel in-flight resource loads during navigation. No cleanup is needed.
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
        case "js":
            return "text/javascript"
        case "json", "webmanifest":
            return "application/json"
        case "png":
            return "image/png"
        case "css":
            return "text/css"
        case "svg":
            return "image/svg+xml"
        default:
            return "application/octet-stream"
        }
    }

    private func textEncoding(for fileURL: URL) -> String? {
        switch fileURL.pathExtension.lowercased() {
        case "html", "js", "json", "webmanifest", "css", "svg":
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
