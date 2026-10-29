import Foundation

// Session API exports have a separate generated-resource guard from core config.
enum SessionResources {
    static let ui: JSValue = {
        let url = Bundle.module.url(forResource: "session-ui", withExtension: "json", subdirectory: "SessionBundled")!
        return try! JSONParser.parse(String(decoding: Data(contentsOf: url), as: UTF8.self))
    }()
}
