// swift-tools-version:5.9
// ShiziCore：规则与数据的 Swift 版（B4，docs/engineering/v10/B3B4-原生化架构与计划.md §4）。
// 只依赖 Foundation。App 接入在 B4.5（本卡不改 ShiziApp.xcodeproj）；shizi-core-cli 供 node 侧差分 / 调度模拟器用。
import PackageDescription

let package = Package(
    name: "ShiziCore",
    platforms: [.macOS(.v12), .iOS(.v15)],
    products: [
        .library(name: "ShiziCore", targets: ["ShiziCore"]),
        .library(name: "ShiziImageRendering", targets: ["ShiziImageRendering"]),
        .library(name: "ShiziStrokePack", targets: ["ShiziStrokePack"]),
        .executable(name: "shizi-image-cli", targets: ["shizi-image-cli"]),
        .executable(name: "shizi-core-cli", targets: ["shizi-core-cli"]),
    ],
    targets: [
        .target(name: "ShiziImageRendering", dependencies: ["ShiziCore"], resources: [.copy("Bundled")]),
        .target(name: "ShiziStrokePack", path: "Sources/ShiziStrokePack"),
        .executableTarget(name: "shizi-image-cli", dependencies: ["ShiziImageRendering"]),
        // 调试构建也开 -O：容量实测类的转写测试（300 个真字 × 多份编码）在 -Onone 下要几分钟，-O 下几秒；断言与 @testable 不受影响。
        .target(name: "ShiziCore", path: "Sources/ShiziCore", exclude: ["Bundled/README.md", "Session/SessionBundled/README.md"], resources: [.copy("Bundled"), .copy("Session/SessionBundled")], swiftSettings: [.unsafeFlags(["-O"], .when(configuration: .debug))]),
        // CoreEngine（字符串键的 op 表 + JSON 行协议）只给测试与 shizi-core-cli 用；App 只链 ShiziCore，不带这层测试脚手架。
        // 它用到的 ShiziCore 内部符号标成 package（同一个包内可见，包外与 App 的公开 API 不变）。
        .target(name: "ShiziCoreEngine", dependencies: ["ShiziCore"], path: "Sources/ShiziCoreEngine", swiftSettings: [.unsafeFlags(["-O"], .when(configuration: .debug))]),
        .executableTarget(name: "shizi-core-cli", dependencies: ["ShiziCore", "ShiziCoreEngine"], path: "Sources/shizi-core-cli"),
        .testTarget(
            name: "ShiziCoreTests",
            dependencies: ["ShiziCore", "ShiziCoreEngine"],
            path: "Tests/ShiziCoreTests",
            resources: [.copy("Fixtures")],
            swiftSettings: [.unsafeFlags(["-O"], .when(configuration: .debug))]
        ),
        .testTarget(
            name: "ShiziStrokePackTests",
            dependencies: ["ShiziStrokePack"],
            path: "Tests/ShiziStrokePackTests"
        ),
    ]
)
