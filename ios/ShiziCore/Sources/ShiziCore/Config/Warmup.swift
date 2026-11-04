import Foundation

// 冷启动预热：App 一启动就在后台线程把「只读、加载后不再变」的懒加载资源先碰一遍，主线程第一次用到时现成。
// 只改「什么时候」加载，不改加载什么、加载成什么：这里碰的全是 static let（及 CoreResources 的加锁缓存），
// 值来自包内 JSON，初始化不读任何可变状态。
//
// 线程安全：
//   · Swift 的 static let（全局 / 类型静态存储）首次访问由 swift_once（Darwin 上 dispatch_once）保证只初始化一次；
//     主线程在后台初始化进行中碰到同一个 static，会等它做完再拿到同一个值，不会重复初始化。
//   · 初始化之后都是不可变值（JSValue / JSObject / 数组 / 结构体，类的话全是 let）；多线程同时只读是安全的。
//   · CoreResources.load 自己有锁（读文件 + 解析在锁内）；DeckIndex 的 newOrder / warmup 缓存也有锁——这里不调它们。
//   · 不会死锁：各 static 的初始化只依赖排在它前面的 static（依赖图无环，单线程本来就要求如此），
//     而持着 CoreResources.lock 的代码不碰任何别的 static 初始化（只有 lock / cache / Bundle.module 本身）。
//   · 不碰的：可变的共享对象（SessionTextLines.shared、RecentInk.page、DeckCards.resolverOverride、Lines.provider、
//     Backup.legacyImporter 等）与 Store——它们留在主线程。
public enum CoreWarmup {
    /// 按主线程用到的先后碰：deck.json（SwiftEngineCore.install 最先要 DeckData.shared）→ 首页 view.home 用到的配置与索引 →
    /// 点「开始」才要的 DeckCards（buildCards 全部卡）。可重复调用（第二次全是已初始化的 static，几乎不花时间）。
    public static func warmLaunchResources() {
        _ = DeckData.shared
        _ = Config.policy
        _ = Config.policyMeta
        _ = Config.deckMeta
        _ = Config.copyData
        _ = Copy.table
        _ = Config.deckLibraries
        _ = DeckIndex.shared
        _ = ScheduleDeck.real
        _ = Config.charOrderData
        _ = NewOrder.defaultIndex
        _ = CharOrder.shared
        _ = Config.epigraphsData
        _ = Epigraphs.all
        _ = Config.signature
        _ = CNNumerals.shared
        _ = Dates.defaultDayStartHour
        _ = CardRules.libraries
        _ = CardRules.defaults
        _ = CardRules.promptCopy
        _ = HomeView.brandPath
        _ = try? CoreResources.load("view-seal")
        _ = Config.fsrsConfig
        _ = Config.motion
        _ = DeckCards.shared
    }
}
