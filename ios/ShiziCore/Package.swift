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
        .executable(name: "shizi-image-cli", targets: ["shizi-image-cli"]),
        .executable(name: "shizi-core-cli", targets: ["shizi-core-cli"]),
    ],
    targets: [
        .target(name: "ShiziImageRendering", dependencies: ["ShiziCore"], resources: [.copy("Bundled")]),
        .executableTarget(name: "shizi-image-cli", dependencies: ["ShiziImageRendering"]),
        // 调试构建也开 -O：容量实测类的转写测试（300 个真字 × 多份编码）在 -Onone 下要几分钟，-O 下几秒；断言与 @testable 不受影响。
        .target(name: "ShiziCore", path: "Sources/ShiziCore", resources: [.copy("Bundled"), .copy("Session/SessionBundled")], swiftSettings: [.unsafeFlags(["-O"], .when(configuration: .debug))]),
        .executableTarget(name: "shizi-core-cli", dependencies: ["ShiziCore"], path: "Sources/shizi-core-cli"),
        .testTarget(
            name: "ShiziCoreTests",
            dependencies: ["ShiziCore"],
            path: "Tests/ShiziCoreTests",
            resources: [.copy("Fixtures")],
            swiftSettings: [.unsafeFlags(["-O"], .when(configuration: .debug))]
        ),
    ]
)
