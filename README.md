# 拾字 MVP

这是一个本地运行的汉字书写练习 MVP。

## 主要文件

- `index.html`：产品主页面。
- `hanzi-writer.min.js`：汉字笔顺渲染库。
- `data/`：Hanzi Writer 的单字笔画数据。

## 本地预览

在这个目录中运行：

```bash
python3 -m http.server 8000
```

然后打开：

```text
http://127.0.0.1:8000/
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

