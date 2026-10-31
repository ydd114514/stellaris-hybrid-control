# 大肥鱼 DSH 桌面端

当前桌面快捷方式已更新到0.3.6，安装位置为`C:\Users\YDD\AppData\Local\Programs\CyberfishDSH\0.3.6\大肥鱼 DSH.exe`。包含“群星控制”“B 站直播”“AI 中枢”三个页签。旧版保留，以下旧路径仅作历史参考；源码构建入口和批处理使用`release/dsh-desktop-0.3.6`。AI中枢合并见[合并验证](AI中枢合并验证-2026-10-28.md)，模型选择修复见[模型列表与图标](模型列表与图标-2026-10-28.md)。 缓存、场控目标与思考期间本地监测见[审计记录](场控影响与缓存审计-2026-10-28.md)。 策略调整见[游戏经验适配](群星经验适配与策略审计-2026-10-28.md)。 身份隔离与多轮指导验收见[收尾记录](模拟直播验收与身份隔离-2026-10-28.md)。

这是本项目制作的 Windows 桌面控制台，实际玩家引擎是官方 @deepseek-ai/dsh 的 headless 模式，使用原生 MCP 控制已打开的群星。它与官方发布的 DeepSeek Harness 桌面客户端是两个程序，不将自制界面称为官方客户端。

本机已安装并放置两个桌面快捷方式：`大肥鱼 DSH`指向`C:\Users\YDD\AppData\Local\Programs\CyberfishDSH\0.1.0\大肥鱼 DSH.exe`；`DeepSeek Harness`指向`C:\Users\YDD\AppData\Local\Programs\DeepSeekHarness\DeepSeek Harness.exe`。前者为本项目的群星控制台，后者为[官方原版](https://deepseek.com/harness/)，官方安装包版本0.2.1-rc.3且数字签名验证通过。游戏控制器继续固定使用npm CLI 0.2.1-rc.2，安装GUI未替换该引擎。官方客户端未替用户登录或配置凭据。

已安装控制台的目录设置位于`C:\Users\YDD\Documents\大肥鱼 DSH\.local\dsh-desktop\stellaris-controller.json`，目前指向`E:\肥鱼直播\stellaris-player`。控制台尚依赖该外部项目与本机运行环境，不是可以脱离控制器复制到另一台电脑即用的完整安装包。

双击打开大肥鱼DSH-Windows.bat或release/dsh-desktop-0.1.0/win-unpacked/大肥鱼 DSH.exe，直接显示启动、停止、状态和最近游戏记录。引擎版本、实际入口与当前DSH进程可在“DSH引擎详情”核对。桌面层自身不调用模型。

1. 先手动打开群星，载入当前非铁人单人测试存档，保持真实画面可见。
2. 点击“启动大肥鱼”。没有打开游戏时只提示，不拉起群星、不调用DeepSeek。桌面环境也禁止原生桥不同时自动重启游戏。
3. “停止控制”写新的用户STOP，等待现有监督器退出及正常暂停；没有暂停回读就不冒充“游戏已暂停”。关闭桌面端会停止它自己启动的控制器，只读观察的外部控制器不会因此被停止。

自动定位本工程同级stellaris-player；移动或独立安装后可“更换目录”。Node/Python/DSH和密钥仍由本机群星控制器配置；桌面层不读取密钥正文，不在状态或命令行中暴露密钥。打开桌面端不启动控制器、游戏、直播连接或恢复自动化。

状态每2秒只读本地检查点/进程标记/官方包元数据，不占游戏管道。已停止时数据标“上次游戏记录”；旧current.json PID不会将停止快照伪装成运行中。程序启动阶段与MCP已运行阶段分别显示。

构建与测试（Git Bash）：pnpm typecheck；pnpm exec vitest run tests/stellaris-controller.test.ts；PLAYWRIGHT_CHANNEL=msedge pnpm exec playwright test tests/e2e/stellaris-desktop.spec.ts；pnpm build:dsh；pnpm exec electron-builder --config electron-builder.stellaris.json --win --x64 --dir；node scripts/smoke-dsh-desktop.mjs --packaged。

全部自动测试离线，使用临时目录、模拟预检及无游戏/无API的真实Node子进程。Electron验收使用隔离资料、禁用实际控制器，不修改真实用户数据。

入口apps/desktop/electron/stellaris-main.ts，受限桥stellaris-preload.ts，进程服务stellaris-controller.ts；界面apps/desktop/src/StellarisDesktop.vue。独立发布版不加载原直播工作台的运行状态、QQ账号或平台连接。角色为用户参考图生成的静态透明立绘，来源与提示在相邻群星工程docs/角色素材说明.md，不将该图重授权为AGPL。
