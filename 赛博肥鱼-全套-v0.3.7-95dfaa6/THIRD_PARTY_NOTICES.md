# 第三方声明

## 模型图标

`assets/model-logos/` 使用 [Lobe Icons](https://github.com/lobehub/lobe-icons) 的 `@lobehub/icons-static-svg` 1.101.0（MIT，Copyright 2023 LobeHub），出处及原包校验见该目录 `ASSET_NOTICE.md`，许可全文位于 `licenses/lobe-icons-MIT.txt`。各模型品牌及商标仍属于其权利人，图标仅用于列表识别，不表示官方合作或对中转站模型身份的保证。

## B站直播间协议

`apps/desktop/electron/bilibili-room.ts` 的WBI签名、网页端房间初始化、认证和心跳流程移植参考 [xfgryujk/blivedm](https://github.com/xfgryujk/blivedm) dev 分支（MIT，Copyright 2018 xfgryujk），许可保留在 `licenses/blivedm.txt`。dm_v2消息字段参考 [Akegarasu/blivedm-go](https://github.com/Akegarasu/blivedm-go) 的 `pb/dmv2.proto`；本项目自行实现有大小限制的必要字段读取，未复制生成代码。此连接仅接收直播消息，不发送弹幕、不启动直播。平台协议变化时需要更新，认证和实际消息接收分别显示，不把本地端口监听当作平台连接成功。

## Coopanion 角色引擎

`vendor/coopanion-kit/` 复制自 [Pal-AI-Lab/Coopanion](https://github.com/Pal-AI-Lab/Coopanion)，固定提交 `4afc70898ac1065dd4559d891a2ce0bebd1261f8`。代码按 AGPL-3.0-or-later 分发，完整许可与本地修改说明见该目录的 `LICENSE` 和 `UPSTREAM.md`。项目未复制 NachoBot 或 dycast 代码。

## DeepSeek 大肥鱼本机开发占位贴图

按用户明确要求，首版本机运行使用 Coopanion 自带的 DeepSeek 大肥鱼（鲸鱼娘）贴图。贴图不在上游 AGPL 授权内；角色原设「溟月」署名上善无形，DeepSeek 女仆二创参考 ZipZipPipe，图像由上游通过 ChatGPT 生成拆件。商标归各自权利人。上游完整声明：[THIRD_PARTY_NOTICES.md](https://github.com/Pal-AI-Lab/Coopanion/blob/4afc70898ac1065dd4559d891a2ce0bebd1261f8/packages/cortico-world-desktop-pet/THIRD_PARTY_NOTICES.md)。

贴图仅留在本机开发目录并从版本控制中排除；本次没有远端发布。详情见 `assets/figure/whale/ASSET_NOTICE.md`。

## 人设写法参考

`packages/core/src/persona.ts` 的人设分段（我是谁 / 说话 / 我在意什么 / 小脾气 / 我绝不会）参考了 [Alterssss/dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale)（MIT）README 中的 persona.md 写法建议；人设正文与安全边界为本项目原创，未复制其代码。

## 场景

`apps/stage/StageView.vue` 的小店场景为本项目用 SVG、CSS 编写，未使用第三方背景图片、音乐或字体。系统中文字体由操作系统提供。

## 运行依赖

Electron（MIT，附带 Chromium 及其各自许可）、Vue（MIT）、Vite（MIT）、TypeScript（Apache-2.0）等依赖遵循各自随包许可。

QQ 音乐适配使用 [`@yakult-green-tea/qq-music-api` 3.3.5](https://github.com/yakult-green-tea/qq-music-api)，以 MIT 许可发布，基于 Rain120/qq-music-api，维护者 yakult-green-tea；贡献者包含 chthollyphile、lantudou，详细出处与许可随依赖保留在 `LICENSE`、`ATTRIBUTION.md`。仅使用不监听端口的 serverless 入口，在主进程内执行搜索、扫码和当前账号音源解析。它是社区维护接口，与腾讯或 QQ 音乐无隶属、授权或合作关系。本项目未打包 QQ 音乐歌曲或绕过账号播放权限。

该依赖携带的 koa-static 5.0.0 在 npm 发布物中未附独立许可文件，本项目额外保留[上游 MIT 原文](https://github.com/koajs/static/blob/master/LICENSE)于 `licenses/koa-static-MIT.txt` 并随安装包提供。
