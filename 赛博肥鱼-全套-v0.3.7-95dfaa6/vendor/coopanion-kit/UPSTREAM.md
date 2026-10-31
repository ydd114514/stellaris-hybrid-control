# Coopanion character engine

- Repository: https://github.com/Pal-AI-Lab/Coopanion
- Pinned commit: `4afc70898ac1065dd4559d891a2ce0bebd1261f8`
- Source: `packages/cortico-world-desktop-pet/web/kit/{body,rig}.js` and `web/whale/figure.js`
- License: AGPL-3.0-or-later, with upstream's additional Steamworks permission; the complete upstream license is in `LICENSE`.
- Local changes: `kit/body.js` accepts normalized live audio amplitude in `talk(level)`; `whale/figure.js` adds distinct upper-body gestures for small-shop actions. Both modifications are marked in the source.
- Excluded upstream behaviors: the host never connects pointer drag/throw or desktop window-edge APIs; roaming is controlled by the shop director.

The whale textures are **not** part of this code license. See `THIRD_PARTY_NOTICES.md` at the project root and `assets/figure/whale/ASSET_NOTICE.md`.

2026-10-26: `whale/figure.js` caches image decoding per asset URL, so UV-separated outfit parts can share one texture atlas without decoding it repeatedly. Outfit geometry remains data-driven in the host model.
