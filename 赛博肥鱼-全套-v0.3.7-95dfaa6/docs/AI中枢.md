# 大肥鱼 DSH · AI 中枢

桌面端新增“AI 中枢”页。把直播间的 AI 拆成两个可以用不同模型的同事，通过共享黑板互通：

| 角色 | 职责 | 建议模型 |
| --- | --- | --- |
| 场控老师 | 读 B 站弹幕，接话、吐槽、带玩法（转建议、起名、竞猜、讲解），冷场时解说 | 响应快、口语好：Gemini Flash 等，关闭深度思考 |
| 游戏参谋 | 读群星控制器快照，判断局势、定方针、评估观众建议，必要时给控制器下指令 | 推理强：DeepSeek 等，可开深度思考 |
| 对战席位 | 为多 AI 群星对战预留，每个席位绑定一个帝国和模型 | 当前只保存配置，不参与操作 |

## 服务商

内置模板：DeepSeek、Google Gemini（原生）、OpenAI、Anthropic、千问兼容模式、Kimi、OpenRouter、硅基流动、自定义 OpenAI 兼容。也可以自己填写任意中转地址。

- 接口形态三种：OpenAI 兼容（`/chat/completions`、`/models`）、Gemini 原生（`generateContent`、`/models`，密钥放请求头）、Anthropic 原生（`/v1/messages`、`/v1/models`）。
- 地址只接受 https；本机中转可用 `http://127.0.0.1` / `localhost`。地址不能带账号密码或查询参数。
- 密钥用 Windows 安全存储加密，单独保存在 `userData/ai-keys.enc.json`；界面、配置文件、日志里只有“是否已保存”。
- “拉取模型列表”调用服务商的模型接口，自动去掉向量、语音、绘图类模型，结果缓存在配置里。拉不到时可以直接手填模型名。
- 思考开关只给认识的厂商发专属字段（DeepSeek `thinking`、千问 `enable_thinking`、Gemini Flash `thinkingBudget`、Anthropic `thinking`），自定义中转不会收到它可能不认识的字段。

## 场控如何运行

1. 在“B 站直播”页连接直播间（弹幕来源不变）。
2. 在“AI 中枢”给两个角色选服务商和模型，“测试连接”后保存。
3. 点“启动场控”。有弹幕才调用场控；参谋按复盘间隔读快照，快照没变就不调用；有观众建议待判断时 20 秒内提前复盘。
4. 观众建议的流转：场控接话并把建议放进黑板 → 参谋判断采纳/不采纳/已回答并写理由 → 场控下一轮向直播间公布。
5. 每小时请求总数有硬上限（默认 240）。停止场控会中止在途请求，迟到的回复会被丢弃。
6. 没开播时可以用“彩排弹幕”测试，会实际调用模型。

Windows 0.3.2：角色的“保存并测试”先保存界面当前选择，再测试该角色，避免修改后仍测试旧模型。默认启动程序不启动场控，不调用模型；本次合并只做离线验证，尚未替用户配置新中枢的服务商密钥。

点歌、切歌类弹幕交给音乐模块，场控不重复回应。弹幕和昵称在提示词里明确标为数据，不会变成游戏命令或 Shell 指令。

## 输出与控制器约定

场控和参谋写到当前 stellaris-player 目录的 `.local/commentary/` 下：

- `host-replies.jsonl`：场控每说一句追加一行 `{"id","type":"host","to","text","at"}`。
- `audience-guidance.json`：仅包含公开的建议、参谋结论与当前方针，不包含服务商配置、密钥、内部留言或执行参数。由本机 `stellaris-player` 框面读取并放入状态流的 `audienceGuidance` 字段；列表支持待判断、参谋采纳、未采纳、已回答。采纳表示参谋认可，不表示游戏动作已执行。运行快照超过15秒未更新时，网页回到“待接入”，不会把过期状态显示成仍在运行。
- `strategy-directive.json`：参谋给出指令时整体覆盖写入：

```json
{ "version": 1, "source": "cyberfish-ai-hub", "id": "d-…", "priority": "low | normal | high", "text": "给控制器的一句目标",
  "at": 1793090000000, "agentId": "strategist", "focus": "当前方针", "nextSteps": ["…"], "game": { "summary": "…", "threats": [], "goals": [] } }
```

Windows 0.3.4已为本机相邻stellaris-player接入目标读取：文件需携带当前`gameSessionId`，5分钟有效，作为`strategistAdvice`供游戏AI核对最新状态后评估；不是直接执行命令。停止场控撤销目标文件。实际控制器仍不属于本仓库，配套源码补丁和本次实测限制见[场控与缓存审计](场控影响与缓存审计-2026-10-28.md)。

场控字幕页：启动场控后在 `http://127.0.0.1:17659/host`（“复制字幕地址”）。OBS 添加浏览器源，1920 × 1080，透明背景，只显示最近 45 秒内的场控发言。

## 黑板

黑板分三区：参谋写“游戏局势/当前方针”，场控写“直播间气氛/热点”，观众建议由场控写入、参谋回填结论；另有双方留言。所有列表有上限，保存在 `ai-hub.json`，重启后保留，可在界面清空。

## 代码位置

- `packages/shared/src/ai.ts`：类型。
- `packages/core/src/ai-providers.ts`：三种接口形态的调用与模型列表。
- `packages/core/src/ai-prompts.ts`：场控与参谋的提示词、快照摘要。
- `packages/core/src/ai-blackboard.ts`、`ai-director.ts`：黑板与编排。
- `apps/desktop/electron/stellaris-ai.ts`：主进程服务（配置、密钥、文件输出、字幕页）。
- `apps/desktop/src/StellarisAi.vue`：界面。
- 测试：`tests/ai-providers.test.ts`、`tests/ai-director.test.ts`、`tests/stellaris-ai.test.ts`，全部离线。

多 AI 对战的后续模块可直接使用主进程服务的 `callAgent(席位编号, messages)`，与场控共用服务商、密钥和黑板。

Windows 0.3.5：参谋按当前路线、赤字余量、殖民地瓶颈与防务确定阶段，读取控制器的本机战略复盘，提出主目标、暂缓项与恢复条件，不默认追求扩张。当前工具不支持的专精切换、总督派驻、共同体投票和巨构建造会保留为能力缺口。经验适用范围、日志证据和控制器配套补丁见[策略审计](群星经验适配与策略审计-2026-10-28.md)。

Windows 0.3.6：游戏侧改用不带来源身份的`operationalGoal`。指令可带受限`targetResource`表达本轮重点，编号、来源、角色留在私有回执；公开正文、称呼与语音出口独立检查身份泄漏。多轮真实API回放已验证消费品优先与食物优先分别产生不同的合法首要经济行动，见[模拟直播验收](模拟直播验收与身份隔离-2026-10-28.md)。
