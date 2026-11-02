# 拾字 · 声音素材（D50 ⑦）

| 文件 | 用途 | 响度 |
|---|---|---|
| `j1_page_settle.wav` / `_b` / `_c`（`.caf` 同名） | 判断「收进」（每字一次），三个变体按顺序轮换：纸页落定 | LUFS-M −31，采样峰值 ≤ −10 dBFS |
| `s1_wood_muted.wav`（`.caf`） | 落款盖章（结果页作品首次呈现落款时，每组一次）：木印·闷实 | LUFS-M −23，采样峰值 ≤ −3 dBFS |

- WAV（44.1kHz / 16bit / 单声道）给网页与 PWA；CAF（线性 PCM，小端 16bit，无编码、无 priming 补零）给 iOS 包，B4.9 起放在 App 的原生资源 `ios/ShiziApp/ShiziApp/Sounds/`（包里 `Sounds/`）。两者采样逐字节一致。
- 全部由 `scripts/sound/gen.mjs` **程序合成**（噪声 + 滤波 + 包络 + 衰减正弦模态 + 自造短混响），**没有采样、没有下载任何现成音效**，没有第三方素材，因此 THIRD_PARTY_NOTICES 与关于页**无需署名**。
- 复跑：`node scripts/sound/gen.mjs`（Node ≥ 18，无依赖，不到 1 秒，固定种子，结果逐字节可复现；`test/platform/sound.test.mjs` 会重新生成并逐字节比对）。要看全部候选（含未入选的 j2–j5、s2–s4、笔触 b1 / b2、旧声音对照）用 `--candidates <目录>`。
- 响度关系：判断声比落款低 8dB（耳机）/ 约 6dB（外放），差值已经在文件里，播放端增益（`policy.soundGainDb`）取 0dB；真机觉得落款吓人就调 `TARGET.seal`（或 `soundGainDb.seal`）降 2dB。
- 书写、描红不发声（D50 ⑦）。旧的 82Hz 盖章声与高频纸声已删除。
