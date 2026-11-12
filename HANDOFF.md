> 当前范围更新：用户已取消房间和 AI 主持，改为 B 站链接＋起止时间提取。以 PRODUCT_SPEC_EXTRACTION.md 和新版 README.md 为准；下方为历史交接。

# Codex 开发交接

最终产品需求以 PRODUCT_SPEC_V3.md 为准。先 Phase 1，后 Phase 2。

## 之前的工作
- 2026-11-12 从 https://github.com/yu402118645-boop/yes_or_no_puzzle.git 克隆时，git ls-remote 未返回任何分支，仓库为空。这只是当时的快照，新任务必须重新检查远端。
- 旧实现保存在 work/legacy-blind-import/，原始位置为 /Users/apple/Documents/Codex/2026-11-12/referenced-chatgpt-conversation-this-is-an/yes_or_no_puzzle。当前项目根目录此前为空。
- 旧代码仅为未完成的 Phase 2 盲导入原型，没有多人房间、Durable Objects、AI 主持、原图汤面、进度、提示或游戏结束流程。不得视为最终架构或已交付的应用。
- 旧架构：Worker 静态页面 + Queues + D1；独立 Python 容器中 yt-dlp 查字幕、B 站 player/v2 回退、无字幕时仅下载音轨并 ffmpeg 压缩、OpenAI 转录、结构化提取并二次审查；汤底及 facts 用 AES-GCM 加密，公开状态接口只投影汤面与状态，能力令牌验证访问。
- 旧代码要求提取汤面原文且只取首个完整故事，单视频最长15分钟。这些是旧原型限制，并非新版产品要求。新版由用户提供文字/原图汤面，Phase 2 应提取与所给汤面匹配的汤底，不要直接沿用旧版“首个故事”规则。
- 当前原型 D1、Queues、独立服务不可作为 Phase 1 前置依赖；按新版优先 Worker + 每房间 Durable Object + WebSocket Hibernation + DO Storage，图片存储按实际限制决定。

## 实际验证及状态
- 曾执行 npm test，5项 Node 测试通过：URL边界、公开字段投影、AES-GCM与房间绑定、状态接口令牌隔离、队列重试与失败收口。它们只验证旧导入原型，不代表游戏验收通过。
- Python测试文件已写，尚未确认运行通过。依赖下载曾受网络限制；随后申请下载时会话被中断。没有确认完成 npm 安装、Wrangler 构建、Docker 构建、真实 B 站/API 端到端验证。没有 package-lock.json。
- 代码未提交、未推送、未部署，没有配置 Cloudflare、Google Cloud 或 OpenAI 凭证，没有上线链接。
- 旧代码仍需审查：队列并发重复交付的幂等、字幕接口当前兼容性、无字幕回退、服务总超时、请求体大小、输入输出约束及模型实际可用性。AI 审查不能承诺零剧透。不要把旧原型当生产可用模块。

## 新任务执行边界
- 请直接开始检查远端并开发 Phase 1，不要只写方案。不部署旧盲导入页面，不让 Phase 2 拖延游戏。
- 正式AI回答在服务端严格枚举四类；私有汤底和事实不得进入公开API、WebSocket快照、错误或日志。披露须服务端验证90%进度及二次确认。
- 保留汤面图片原图，支持上传和剪贴板粘贴，不用OCR替代。
- 玩家身份刷新/重连稳定、1–4人限制、AI并发协调/幂等、提示限流、真实事实覆盖进度等按v3逐项验收。
- 模型/参数服务端配置；查询当前官方模型、Cloudflare免费额度与部署条件。不要在前端放密钥。
- 文档要求 Codex Cloud + GitHub、Cloudflare 和 soup.yingxinzone.top；不要求用户安装本地工具；通过官方控制台配置 Secrets，不在聊天中索要密钥。
- 普通技术选择自主处理；新增付费服务、外部授权、不可逆改动/重要代码删除须先说明并确认。Phase 2 额外服务成本须先评估，不因旧原型已有Dockerfile就默认获批。
- 用户本次明确授权创建一个新的 Codex 开发聊天并交接。
