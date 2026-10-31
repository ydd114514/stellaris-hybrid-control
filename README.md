# 群星原生国家 AI 混合控制 · Claude 交接快照

2026-10-31 当前开发状态的源码交接，**不是已验收成品**。先读 [CLAUDE.md](CLAUDE.md)、[HANDOFF.md](HANDOFF.md)、[v1.5计划](STELLARIS_HYBRID_CONTROL_PLAN.md)（替代v1.4，交付优先）。

目标：游戏电脑玩家的原生国家 AI 持续运营玩家帝国；大肥鱼决定战略，实际接管关键干预，完成后交还。逐条调用接口、本地经营脚本或自动调查不能替代这一目标。

## 目录

- `stellaris-player/`：Node控制器、MCP、模型接入、桥加载器、测试与实施记录。
- `赛博肥鱼-全套-v0.3.7-95dfaa6/`：现有Electron/Vue/TypeScript DSH源码。保留目录名和同级关系，避免破坏相对导入。
- `.local/research/stellaris-mcp-native/`：当前C++桥源码，v1.5默认放行门控；这个路径有意纳入版本控制。
- `evidence/`：原始成功/失败报告、独立回读、r2源码对照和离线研究。
- `HANDOFF_INVENTORY.json`：复制源文件SHA256；不是功能验收证明。

## 最短离线验证

Node >=22，控制器无npm运行依赖。在Git Bash的仓库根目录运行：

```bash
cd stellaris-player
node --test test/native-country-ai.test.mjs test/bridge-capabilities.test.mjs test/native-country-ai-tool.test.mjs test/native-country-ai-economic-evidence.test.mjs test/native-country-ai-ship-evidence.test.mjs
node --test test/native-mcp-tools.test.mjs test/native-mcp-schema.test.mjs
node --test --test-name-pattern='country AI host|economic candidate host' test/native-game.test.mjs
```

MCP schema测试依赖当前目录，须在stellaris-player中执行。

Windows C++（MSVC、CMake、Git；首次配置抓取MinHook v1.3.4和nlohmann_json v3.11.3），仓库根目录：

```bash
cmake -S .local/research/stellaris-mcp-native -B stellaris-player/.local/native-bridge/build -A x64
cmake --build stellaris-player/.local/native-bridge/build --config Release
cmake -S stellaris-player/test/native-country-ai-receipts -B stellaris-player/.local/native-country-ai-receipts
cmake --build stellaris-player/.local/native-country-ai-receipts --config Release
ctest --test-dir stellaris-player/.local/native-country-ai-receipts -C Release --output-on-failure
```

v1.5新桥0.6.18已编译、加入本机加载白名单并成为默认，等待一次T6；白名单不等于实机验收。r2 DLL不随源码分发，对照源码在evidence/r2-source-snapshot。跨机器重新编译不能假定DLL哈希一致。

桌面在对应目录按pnpm-lock.yaml安装依赖；缺生成语音时可用 `node scripts/build-dsh.mjs --basic` 构建。鲸鱼贴图须由用户本机补齐/替换。

## 不包含

密钥、个人配置、登录状态、数据库、原始模型流、依赖、DLL/EXE、构建产物、游戏文件/存档、未获分发授权的鲸鱼贴图、生成语音均未上传。真实游戏运行须用户本机手动载入和另配密钥，云端不能直接运行群星。

各子项目保留原许可：控制器MIT、桌面AGPL-3.0-or-later、原生桥MIT、部分研究/加载工具GPL-3.0-only。见各LICENSE、SPDX与THIRD_PARTY_NOTICES，不对全仓库重新统一授权。
