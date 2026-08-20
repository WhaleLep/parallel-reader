# Parallel Reader · 对照阅读器

[中文](README.md) | [English](README.en.md)

轻量、自托管的双语 Markdown 对照阅读器。选择原文和译文后，可以同步滚动、联动高亮并调整段落对应关系。

翻译由 ChatGPT 等外部工具完成；本项目不调用翻译 API，也不需要 API Key。

![双栏同步阅读演示](docs/images/parallel-reader-demo.gif)

## 功能

- 原文与译文双栏阅读，段落跳转同步和双向高亮
- 自动对应标题、段落、列表、引用、代码块和表格
- 支持手动调整段落对应关系，并保存阅读位置
- 可在浏览器内存中临时打开 Markdown，文件、进度和段落对应不会上传
- 导入、改名和删除本地 Markdown，也可只读加载现有 Markdown 目录
- 顶部工具区可收起；桌面端可拖动调整左右宽度
- 在英文原文中选取单词或短语，自动收集文档标题和所在句，并批量复制为 ChatGPT 学习提示词
- 手机端自动切换为上下布局
- 无前端构建步骤，无 CDN 和翻译 API 依赖

## 纯前端临时阅读

只使用“临时打开文件”时，不需要运行 `app.py`。直接用现代浏览器打开 `static/index.html`，或者把 `static/` 目录作为普通静态网站提供即可。

Markdown 文件由浏览器直接读取，渲染、自动对齐、滚动同步和手动调整均在当前页面完成。文件内容不会上传；阅读进度和段落对应也不会持久保存，并会在关闭或刷新页面后消失。

纯前端模式不能使用服务器的只读文档目录、文档书库以及持久化进度。页面尝试读取书库时可能显示后端不可用，但不影响临时阅读。

## 完整模式

如需只读文档目录、服务器书库和持久化进度，请运行 Python 后端。推荐使用 [uv](https://docs.astral.sh/uv/)：

```bash
git clone https://github.com/WhaleLep/parallel-reader.git
cd parallel-reader
uv run python app.py
```

打开 <http://127.0.0.1:8084>。首次启动会自动创建 `data/` 和 `documents/`；按 `Ctrl+C` 停止。

没有 uv 也可以使用 Python 3.10 或更高版本：

```bash
python3 app.py
```

## 基本使用

1. 准备两份 Markdown：英文原文和对应的中文译文。
2. 点击“临时打开文件”在当前页面中阅读，或点击“导入到书库”长期保存；也可以将现有文档放进 `documents/`。
3. 分别选择原文和译文，点击“开始对照”。
4. 点击任一段落可联动高亮；需要时使用“调整对应”修正配对。

需要让 ChatGPT 根据英文文本或公开网址生成严格对应的两份文档时，可直接使用 [对照文档生成提示词](docs/translation-prompt.zh-CN.md)。

书库中的导入文件、段落映射和阅读进度保存在 `data/`。只要配对中包含临时文档，文件、段落映射和阅读进度就只存在于当前页面内存中，并在关闭或刷新后消失。

本次生词篮仅保存在当前标签页的 `sessionStorage` 中：刷新后仍然保留，关闭标签页后自动消失，不会写入服务器或 SQLite。

## Docker 部署

Docker 适合 VPS 或长期运行：

```bash
mkdir -p data documents
docker compose up -d
```

默认使用项目内的 `data/` 和 `documents/`。需要挂载其他目录时，可在 `.env` 中设置 `DOCUMENTS_PATH` 和 `READER_DATA_PATH`：

```bash
cp .env.example .env
# 修改 .env 中的目录后运行
docker compose up -d
```

Compose 只将服务映射到 `127.0.0.1:8084`。如需公网访问，请使用带 HTTPS 和身份认证的反向代理，不要直接暴露后端端口。

## 项目结构

```text
parallel-reader/
├── app.py                  # Python 标准库后端
├── static/                 # 前端资源
├── compose.yaml            # Docker 部署
├── pyproject.toml          # uv / Python 项目配置
├── uv.lock                 # uv 锁定文件
├── documents/              # 只读 Markdown 来源（不入库）
└── data/                   # 导入文档与 SQLite 数据（不入库）
```

后端仅使用 Python 标准库和 SQLite。Markdown 渲染器 Marked 随项目部署；许可信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## License

[MIT](LICENSE)
