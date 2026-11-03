import AVFoundation
import Foundation

// 声音：判断「收进」的纸页落定（三个变体，SwiftEngine 轮换）与落款的木印盖章（S1，D50 ⑦）。B4.9 从 WebViewController 搬出来。
// 素材是打进包里的 CAF（App 的原生资源 Sounds/*.caf，仓库 ios/ShiziApp/ShiziApp/Sounds/；线性 PCM 16bit，无编码、无 priming 补零，
// 起音从第 0 个采样开始；scripts/sound/gen.mjs 程序合成，网页用同样采样的 WAV）。
// AVAudioSession 用 .ambient + .mixWithOthers：遵守静音键（静音时完全无声），与后台音乐混音——不打断、不压低（不用 duckOthers）。
// 书写与描红没有声音；播哪个文件（kind = 文件名，不含扩展名）与增益 gain 由引擎定（SwiftEngineCore 的判断声、EngineHost 的落款声）。
final class SoundPlayer {
    static let shared = SoundPlayer()

    static let soundNames = ["j1_page_settle", "j1_page_settle_b", "j1_page_settle_c", "s1_wood_muted"]

    /// 文件名 → 预载好的播放器；preload() 在首帧之后填满。
    private var players: [String: AVAudioPlayer] = [:]

    /// 包里的声音目录（Sounds/）。
    static var directory: URL? { Bundle.main.url(forResource: "Sounds", withExtension: nil) }

    func preload() {
        guard players.isEmpty, let directory = Self.directory else { return }
        try? AVAudioSession.sharedInstance().setCategory(.ambient, mode: .default, options: [.mixWithOthers])
        for name in Self.soundNames {
            let url = directory.appendingPathComponent("\(name).caf")
            guard let player = try? AVAudioPlayer(contentsOf: url) else { continue }
            player.prepareToPlay()
            players[name] = player
        }
    }

    func play(kind: String, gain: Double) {
        guard let player = players[kind] else { return } // 未知名字忽略（旧的 stamp / paper 已不存在）
        ShiziProbe.feedback("sound:\(kind)")
        player.volume = Float(min(max(gain, 0), 1))
        player.currentTime = 0
        player.play()
    }
}
