# 一碗汤 · B 站汤底片段提取

最新需求：只输入 B 站视频链接和汤底对应的时间段，自动提取该片段文字。不再提供房间、多人聊天、AI 主持或推理进度。

网站：**https://soup.yingxinzone.top/**。本版本覆盖原游戏首页，原游戏实现保留在源码和 Git 历史中，旧房间接口在新入口中不可访问。最新功能边界见 `PRODUCT_SPEC_EXTRACTION.md`，之前的游戏任务书不是当前开发范围。

## 使用

1. 粘贴 `https://www.bilibili.com/video/BV…/` 或 `https://b23.tv/…` 链接；支持 `?p=2` 分 P。
2. 输入起始时间，例如 `21:54`，也接受 `21.54`、`01:21:54` 或纯秒数。
3. 结束时间可不填，默认取该分 P 结尾。单次时间段最多 30 分钟；超出时明确要求分段。
4. 等待提取，复制或下载文字。结果附带来源、时间及逐句时间标记。

结果是所选片段的原文／语音转写，不用语言模型改写，不保证该片段包含完整汤底，不自行补充故事。字幕和转写的句子若跨越时间边界，会保留整句，结果页会说明。

## 提取顺序与限制

- 读取并校验视频元信息及分 P，以签名播放器接口获得字幕，检查 aid/cid 对应关系。优先中文人工／自动字幕，按时间截取。
- 没有公开字幕时，尝试读取公开 DASH AAC 音轨的初始化区间和 SIDX 索引，按索引使用 HTTP Range 读取选中片段，将 fMP4 时间戳归零后交给 Cloudflare Workers AI Whisper 转写。不会下载整部视频，也不运行 yt-dlp、ffmpeg 或 Docker。
- 不需要 OpenAI API Key；不会调用 OpenAI 付费 API。Whisper 模型由 Cloudflare 提供，不是使用当前聊天／Codex 订阅额度。
- 仅支持可公开读取、支持 Range 和直接 SIDX 索引的音轨；不支持的编码／索引、无有效语音、登录要求、地区／付费／风控限制会明确失败。不会绕过访问控制，也不拿弹幕、简介或其他视频字幕冒充结果。
- 语音识别可能有错字、漏字或误识别，必须对照原视频核对；过滤高无语音概率和低置信度片段不能保证绝对准确。

## 架构

单 Worker + 异步提取任务 Durable Object + Workers AI + 静态页面。Durable Object 只用于任务、进度和免费用量限制，不是游戏房间。无独立服务器、数据库产品、Queue、R2 或原生处理容器。

`src/extractor-worker.js` 为当前入口，`src/bilibili.js` 负责受限来源请求，`src/mp4.js` 负责音轨字节截取；当前页面位于 `extractor-public/`。原游戏 `src/worker.js` 和 `public/` 不对外提供游戏接口。保留原 Room namespace／迁移以免破坏已有状态，没有做数据删除迁移。

## 费用与配额

Cloudflare [Workers AI 官方价格](https://developers.cloudflare.com/workers-ai/platform/pricing/)在 2026-11-12 核实：Free 计划每天 10,000 Neurons，超额停止；Paid 计划超额可产生费用。此工具不自动升级套餐。请保持当前账户 Free 计划。

[Whisper large v3 turbo](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/) 官方提供 Cloudflare 语音转写；额度与账户内其他 AI 服务共享，不能保证始终有余额。本站在转写前预留每日最多 90 分钟音频，失败任务也占用预留额度，不自动重试消耗。按约 46.63 Neurons／分钟的官方价格表估计约 4,200 Neurons／日，最终以官方用量为准。字幕路径不消耗 AI 额度。

每 IP 每小时最多 5 次提交；任务及结果一小时后删除；任务令牌放在 sessionStorage，状态 API 需要 Authorization；不返回音轨地址或上游错误正文。来源 URL／字幕流／音频流有域名、长度、超时和大小限制。模型不接收网页指令，只有音频转写。

## 部署

继续使用已有 Cloudflare Worker `yes-or-no-puzzle` 和 GitHub `main` 自动部署，保留 `soup.yingxinzone.top`。配置含 `AI` Workers AI binding 和 SQLite `EXTRACTIONS` namespace，`nodejs_compat` 用于标准 WBI 签名散列。无需用户本机安装任何工具。

Cloudflare 构建命令：`npm test && npm run check`；部署命令：`npm run deploy`；构建 Node 24。开发者在现有环境可运行 `npm test` 和 `npm run check`。没有需要粘贴到聊天的密钥。新绑定如需账户开通／接受条款，由用户在官方控制台确认，不擅自启用付费套餐。

## 验证状态

本机自动化测试覆盖 URL／时间、时间段字幕、跨域请求边界、SIDX 字节偏移、fMP4 时间戳修正、禁止整视频回退、字幕 ID 绑定和真实 workerd 异步提取流程。真实 B 站视频、音频解码和线上 Workers AI 仍需以实际部署后的测试结果为准，模拟通过不等于真实提取成功。结果记录见 `EXTRACTION_TESTING.md`。

用户指定验收视频：`https://www.bilibili.com/video/BV1CmLHz9EnN/`，起点 `21:54`，终点默认视频结束。

签名流程参考 [yt-dlp Bilibili 提取器实现](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/bilibili.py)，未将其整个处理服务带入项目。
