# 一碗汤 · Yes / No Puzzle

按 `PRODUCT_SPEC_V3.md` 实现的 Phase 1 多人海龟汤。一个 Worker + 每房间一个 SQLite Durable Object + WebSocket Hibernation + 静态页面；没有 D1、Queue、R2 或独立服务器。另有一个共享 DO 用于创建限流。旧导入原型位于本地 `work/legacy-blind-import/`，被 Git 忽略，不参与构建或部署。

## 已实现

- 文字汤面、上传／粘贴 PNG/JPEG/WebP 原图，图片最大 2 MiB，原始字节保留、可放大。图片分成 64 KB 存于同一房间 DO，无需开通 R2；AI 判断时可读取原图视觉线索。
- 创建分享链接；1–4 个匿名席位；浏览器按房间保存随机身份令牌，刷新与重连恢复昵称；同一身份仅保留一个连接。
- 公开聊天与正式 AI 提问分开；最近 200 条公开消息同步给新加入／重连者。
- 服务端调用 OpenAI Responses API，结构化输出加服务端四种枚举白名单；正式回答没有自由文本说明。
- 创建时提取 5–12 项私有关键事实；只接受带有本次问题原文证据的模型覆盖结果；进度为已发现事实数量／总事实数量。聊天次数不增加进度。
- 提示模型只接收公开汤面、公开历史和百分比，只能选择三个温和策略之一，服务端输出固定引导文案。不会把私有事实提供给提示生成。此版本提示偏保守，不生成故事专属新线索。
- 90% 后任意参与者可发起公布；服务端产生与身份绑定、30 秒过期的确认令牌；确认后公开完整汤底并结束，拒绝后续聊天／AI 操作。
- 服务端投影公开字段；身份令牌、事实和未公布汤底不在公开 API／WS 中。错误只返回固定信息，不输出模型响应或堆栈；关闭 Worker 应用日志；前端以 `textContent` 显示输入。

## 配置与费用开关

`wrangler.jsonc` 包含 SQLite migration、静态资源绑定和以下服务端参数：

| 参数 | 默认 | 说明 |
|---|---|---|
| `AI_MODEL` | `gpt-6.1-sol` | 高性能推理模型，可改为账户可用的其他模型 |
| `AI_REASONING` | `high` | 推理强度 |
| `MAX_AI_CALLS` | `80` | 每房间全部模型请求上限，含创建时提取、提示和失败调用 |
| `MAX_ROOMS_PER_DAY` | `10` | 整个应用每天创建尝试上限，按 UTC 日重置 |
| `ALLOW_CREATE` | `false` | 配置好密钥、确认模型费用后才改为 `true` |

密钥名 **`OPENAI_API_KEY`**。只在 Cloudflare Worker → Settings → Variables and Secrets → Add → Secret 配置，不写入代码、不发到聊天、不放 GitHub 普通变量。使用单独 OpenAI 项目密钥，在官方项目设置检查模型访问和用量限额。应用开关 `ALLOW_CREATE=false` 可立即停止新增房间；删除／轮换密钥可停止所有后续模型请求。

限制：每 IP 每小时最多 5 次创建尝试；全站每天最多 10 次；每人发送间隔至少 700ms；每房间 AI 间隔至少 4 秒、同时一个请求；提示共享 60 秒冷却；输入汤面 8000 字符、汤底 16000 字符、消息 1500 字符；模型单请求最多 5000 输出 tokens、60 秒超时，不自动重试。重复消息有持久化去重标识。模型调用前先持久化占用次数和请求标识，避免重连重复付费；如果请求中途异常或对象重启，可能不会完成该次回答，玩家可重新提交新的问题。

## 不需要本机工具的部署流程

推荐在已授权的 Codex Cloud／GitHub 开发环境完成代码推送，再使用 Cloudflare 官方 GitHub 集成。当前本地开发聊天**不是已运行的 Codex Cloud 任务**。

1. 将本目录代码推到 `https://github.com/yu402118645-boop/yes_or_no_puzzle`。如需授权，仅在 GitHub／Codex 官方登录界面完成，不向聊天发送 Token。
2. Cloudflare Dashboard → Workers & Pages → Create application → 连接 GitHub，选择该仓库，创建 **Worker**（不是静态 Pages 项目）。授权只选择该仓库。项目根目录是仓库根目录。
3. 配置构建命令 `npm ci && npm test && npm run check`，部署命令 `npm run deploy`，运行环境 Node 24。`wrangler.jsonc` 会创建 SQLite DO namespace 和静态资源绑定。
4. 首次保持 `ALLOW_CREATE=false` 部署；在 Worker Settings 的 Secrets 中设置 `OPENAI_API_KEY`。检查 OpenAI 项目有对应模型权限、余额／费用限制，再将仓库 `ALLOW_CREATE` 改成 `true` 并重新部署。不要只改控制台同名普通变量，因为下一次仓库部署可能覆盖它。
5. 在 Cloudflare 开发域名打开首页，再邀请两个独立浏览器测试。首次正式模型测试会产生费用，应在确认预算后进行；真实 API 质量与云端验收清单见 `TESTING.md`。
6. 绑定域名：确保 `yingxinzone.top` 已在该 Cloudflare 账户管理。Worker → Settings → Domains & Routes → Add → Custom Domain → `soup.yingxinzone.top`。由官方控制台创建 DNS 与证书。若已有同名记录或服务，先检查冲突并确认替换，不删除不明记录。
7. HTTPS 生效后，用该域名重新创建并分享游戏链接；身份保存在浏览器当前域名下，开发域名身份不会自动迁移。

GitHub CI（`.github/workflows/check.yml`）只运行测试和部署包检查，不存储部署密钥，不自动上线。Cloudflare Git 集成承担部署和账户授权。以上控制台路径以实际账户 UI 为准，DO 免费计划须支持 SQLite。

如果已有完整云端开发环境，开发者命令为 `npm ci`、`npm test`、`npm run check`、`npm run dev`。这不是要求用户在自己电脑安装工具。

## 核实的成本条件（2026-11-12）

- [Workers 官方价格](https://developers.cloudflare.com/workers/platform/pricing/)：Free 每日 100,000 请求，CPU 每次 10ms；超限可能拒绝请求。图片处理与状态序列化在较大输入时仍需线上测量 CPU。
- [Durable Objects 官方价格](https://developers.cloudflare.com/durable-objects/platform/pricing/)：Free 可使用 SQLite DO；每日 100,000 请求、13,000 GB-s；SQLite 每日 500 万行读、10 万行写，总计 5 GB 存储。超免费额度会失败。静态空闲 WS 使用 [Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) 减少计算时长。每次广播、存储和模型等待仍可能消耗额度。
- [OpenAI 官方模型目录](https://developers.openai.com/api/docs/models)和 [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)：目录当前提供 `gpt-6.1-sol`，输入 $2／百万 tokens、输出 $10／百万 tokens。模型调用不是 Cloudflare 免费资源；实际权限与价格以官方账户为准。
- 每局主要成本是“创建事实清单 + 正式问题 + 提示”的模型调用，推理 tokens 和图片输入都影响费用。示例：若全局累计输入 10 万、输出含推理 5 万 tokens，按上述价格约 $0.70。不是每局固定报价。
- 按单请求最多 5000 输出 tokens，80 次调用仅输出部分理论上约 $4，**另加全部输入费用**；80 次不是美元预算。OpenAI 预算告警不应被视作绝对硬上限。可降低 `MAX_AI_CALLS` 和每日房间数，不必降低模型质量。
- 免费资源限额和单对象存储／执行限制仍适用；没有启用付费 Workers 计划、R2、容器或其他付费服务。

## 已知限制

- 尚未配置真实账户密钥，未执行真实付费模型质量评测、互联网多人联机、Cloudflare 免费 CPU 测量或正式域名验收，不能据模拟测试声称上线可玩。
- 事实提取与语义覆盖仍依赖模型，可能误判、漏判或过早估计进度；四种输出限制可防止正式回答夹带文字，但不能保证语义判断永远正确。提示只输出约束策略，较保守。
- 每房间保留 4 个身份席位至过期，不回收离线席位，以保证短时断线／刷新稳定；关闭无痕浏览器、清除站点数据或换设备无法找回身份。UI 显示的是已加入人数，不是在线人数。
- 房间从创建起保留 7 天，然后删除汤底、历史、原图和身份；只展示最近 200 条记录。房间链接相当于朋友间的邀请，任何持有链接的人可占一个席位。
- Hibernation API 连接已在本机验证；持久化恢复通过对象重建测试。强制真实休眠测试在当前 Miniflare 版本因 active references 超时，未通过，须在 Cloudflare 预览部署进一步核实。历史较多或 2 MiB 图片的极限负载尚未线上测量。
- AI 请求期间该房间操作排队，最多等待模型超时 60 秒；界面显示处理中。模型失败可重新发送，失败请求也计入预算。
- Phase 2 B 站盲导入未开发／未部署。后续应提取与用户汤面匹配的汤底；无字幕音频服务与费用必须另行确认。旧代码不是生产功能。

## 源码

`src/worker.js`：入口、房间、身份、实时状态及限流；`src/core.js`：公开投影与数据规则；`src/ai.js`：私有模型调用与结构化约束；`public/`：响应式中文界面；`test/`：业务边界与真实 workerd 集成测试。最终产品边界见 `PRODUCT_SPEC_V3.md`。
