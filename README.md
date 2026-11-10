# 墨阅 · DSH 左侧栏插件

把本地电子书阅读器「墨阅」挂进 DeepSeek Harness 左侧栏：

- 左侧栏新增「墨阅」图标（order 20，位于默认面板图标之间）
- 点击后在主区域打开阅读器面板（内嵌 `http://127.0.0.1:7788`）
- Host 半负责保活：DSH 启动 / 服务退出时自动拉起阅读器服务（15s 健康检查）
- Host 半同时提供 **AI 章节导读 / AI 书架分类代理**（`http://127.0.0.1:7797`）：阅读器把当前章节文本发来生成摘要、导读、结构化分析与思考问题；书架把书名/作者发来按主题分组（仅允许 `127.0.0.1:7788` 阅读器页面调用）
- 面板右上角支持「刷新」和「独立窗口」
- 阅读器本体单独开源在 [wisdomzking/moyue-reader](https://github.com/wisdomzking/moyue-reader)（EPUB / PDF / MOBI / AZW3 / Word / TXT 等）
- 本插件仓库：<https://github.com/wisdomzking/moyue-dsh-plugin>

## 安装

先克隆插件与阅读器本体（建议放在同一父目录，插件默认从 `D:\tools\dsh\ebook-reader` 拉起阅读器）：

```bat
git clone https://github.com/wisdomzking/moyue-reader.git D:\tools\dsh\ebook-reader
git clone https://github.com/wisdomzking/moyue-dsh-plugin.git D:\tools\dsh\moyue-dsh-plugin
cd /d D:\tools\dsh\ebook-reader && npm install
```

再让 DSH 安装本地插件：

```text
plugin_manager action=install_bundle target=D:\tools\dsh\moyue-dsh-plugin
```

首次安装返回 `restart-required`：**重启 DeepSeek Harness 后生效**（关闭窗口再打开）。
重启后左侧栏出现墨阅图标，点击即可阅读。

## 自检（无需浏览器 / DSH）

```bat
node test\selftest.mjs
```

校验客户端槽位注册（sidebar.panellist + main）与 Host 保活逻辑（启停服务）。

## 配置

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `MOYUE_APP_ROOT` | `D:\tools\dsh\ebook-reader` | 阅读器程序目录 |
| `MOYUE_PORT` | `7788` | 本地服务端口（需与 `client.js` 中 READER_URL 一致） |
| `MOYUE_AI_PORT` | `7797` | AI 章节导读代理端口（需与阅读器 `web/js/ai-guide.js` 中 `AI_ENDPOINT` 一致） |
| `MOYUE_NODE` | 自动探测 | 指定 node 可执行文件 |

## 结构

```
package.json       dsh.bundle.patch + dsh.client（web / 立即加载 / 依赖注入）
cordis.patch.yml   插入 Host 插件行 moyue-reader
index.js           Host 半：阅读器服务看门狗 + AI 章节导读代理（ctx.llm.stream）
client.js          Client 半：左侧栏图标 + main 面板（iframe）
locale/*.json      插件展示元数据（中文 / English）
icon.svg           插件图标
```

## AI 章节导读 / 书架分类与隐私

- 阅读器把**当前章节/页面的纯文本**（最多约 1.8 万字符）发到本机 `127.0.0.1:7797`，由插件调用当前 DSH 默认模型（如 `deepseek-account/deepseek-flash`）生成；书架 AI 分类则发送**书名、作者、格式**清单。
- 章节文本会发送给模型服务商；生成结果按「书 + 章节」缓存在阅读器浏览器 localStorage，重复打开同一章不会再次请求。AI 分类结果由阅读器保存为书架文件夹。
- 每次生成会消耗 DSH 模型额度；关闭插件或 DSH 后 AI 功能不可用，阅读器本体不受影响。
- 代理只监听 `127.0.0.1`，并只接受来自 `http://127.0.0.1:7788` / `http://localhost:7788` 的请求。
