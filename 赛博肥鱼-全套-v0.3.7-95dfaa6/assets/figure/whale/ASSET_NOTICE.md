# 本机开发占位形象：DeepSeek 大肥鱼

按项目所有者 2026-10-26 的明确要求，初期沿用 Coopanion 的 DeepSeek 大肥鱼桌宠。该名称对应上游的鲸鱼娘形象。

来源：https://github.com/Pal-AI-Lab/Coopanion/tree/4afc70898ac1065dd4559d891a2ce0bebd1261f8/packages/cortico-world-desktop-pet/web/whale

上游第三方声明原文：

> `web/whale/` 的贴图由 ChatGPT(OpenAI 的图像模型)按参考图生成后拆件:角色原设为「溟月」(上善无形),DeepSeek 女仆装二创参考 ZipZipPipe。
>
> 这些贴图不在本包的 AGPL 授权范围内。它们随 Coopanion 分发,想在别处使用请自行确认原设与各家标志的权利。

默认配色围裙包含 DeepSeek 商标，归权利人所有，不代表本项目与其存在合作或认可关系。

本机 `tex/`、`feat/`、`outfits/` 仅用于用户指定的首版本机开发占位，已在版本控制忽略列表排除。未执行远端发布。发布或正式运营时应替换为有明确使用权的资产，或取得相应权利确认。

`model.json` 和 `figure.json` 为上游角色结构数据，保留出处；程序实现的授权见 `vendor/coopanion-kit/LICENSE`。

2026-10-26，按用户另行提供的三视图新增 `outfits/cowboy`、`outfits/pumpkin`、`outfits/ghost` 图集。图集由内置 image_gen 按参考服装重新绘制，用于本机形象接入；原角色、参考服装和标志的权利不因本项目的代码授权而改变。制作提示词、文件位置和骨骼适配说明见项目根目录 `服装素材制作记录.md`。
