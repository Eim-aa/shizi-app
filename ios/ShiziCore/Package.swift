// swift-tools-version:5.9
// ShiziCore：规则与数据的 Swift 版（B4，docs/engineering/v10/B3B4-原生化架构与计划.md §4）。
// 只依赖 Foundation。App 接入在 B4.5（本卡不改 ShiziApp.xcodeproj）；shizi-core-cli 供 node 侧差分 / 调度模拟器用。
import PackageDescription

let package = Package(
    name: "ShiziCore",
    platforms: [.macOS(.v12), .iOS(.v15)],
    products: [
        .library(name: "ShiziCore", targets: ["ShiziCore"]),
        .executable(name: "shizi-core-cli", targets: ["shizi-core-cli"]),
    ],
    targets: [
        .target(name: "ShiziCore", path: "Sources/ShiziCore", resources: [.copy("Resources")]),
        .executableTarget(name: "shizi-core-cli", dependencies: ["ShiziCore"], path: "Sources/shizi-core-cli"),
        .testTarget(
            name: "ShiziCoreTests",
            dependencies: ["ShiziCore"],
            path: "Tests/ShiziCoreTests",
            resources: [.copy("Fixtures")]
        ),
    ]
)
