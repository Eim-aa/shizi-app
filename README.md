# 拾字 MVP

这是一个本地运行的汉字书写练习 MVP。

## 主要文件

- `index.html`：产品主页面。
- `hanzi-writer.min.js`：汉字笔顺渲染库。
- `data/`：Hanzi Writer 的单字笔画数据。
- `scripts/`：生成数据和验证页面的脚本。
- `generated/`：当前生成出的 500 字结构化结果。
- `sources/`：生成脚本依赖的原始字表、字频和词典数据。
- `requirements.txt`：生成脚本需要的 Python 依赖。

## 本地预览

在这个目录中运行：

```bash
python3 -m http.server 8000
```

然后打开：

```text
http://127.0.0.1:8000/
```

## 重新生成题库

第一次运行前安装依赖：

```bash
python3 -m pip install -r requirements.txt
```

重新生成 `index.html` 内置题库和 `generated/selected_500_chars.json`：

```bash
python3 scripts/build_500_chars.py
```

运行浏览器验证：

```bash
node scripts/verify_500_app.js
```

## Git 使用

查看当前文件变化：

```bash
git status
```

保存一个版本点：

```bash
git add .
git commit -m "描述这次改了什么"
```

查看历史版本：

```bash
git log --oneline
```
