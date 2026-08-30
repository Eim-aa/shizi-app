# 语境质量门

`data/context-quality.js` 由 `scripts/build_context_quality.py` 生成，输入固定为当前 `deck-data.js` 与 `sources/jieba_dict.txt`。

质量门只决定题面是否展示现有语境，不删除字卡，也不改变拼音、目标字、字库归属或记忆键。命中以下任一规则时，题面退回「只按拼音写」：

- 语境是机械生成的「目标字 + 字」占位词；
- jieba 给同一词记录的全部词性非空，且都是 `nr / nrt / nrfg / ns / nt` 专名标签；该词不超过 3 个汉字、词频不高于 300；
- 语境至少 4 个汉字，且词频不高于 300。

同词若在 jieba 中有多行，生成器汇总全部词性并取最高词频；只要存在普通词性，便不因另一条专名词性自动下架。专名增加词频和长度门槛，是为了保留「中国、北京」等已经词汇化的常见语境。人工批准的 `data/context-overrides.js` 始终优先，可为误伤项提供常用词或不泄题的白话释义。

重建命令：

```bash
python3 scripts/build_context_quality.py
```

生成结果必须与脚本重建结果一致，并由 Web 回归验证占位词不再直接展示、人工覆盖仍然生效。
