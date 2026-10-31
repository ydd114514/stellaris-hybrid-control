# Stellaris Companion independent save parser

- Upstream: https://github.com/gitmaan/stellaris-companion
- Pinned source commit: `4aada5dc33264f9293ebdc7cd90dd40d29987b40`
- Release: https://github.com/gitmaan/stellaris-companion/releases/tag/v1.1.1
- License: MIT; upstream license text is preserved in `LICENSE`.
- Bundled executable: `stellaris-parser.exe`, reporting tool version `0.4.0`.
- Executable SHA-256: `028cdc1e447273df6cf46eaeaea975209b5905be17b982d784ebf85a286f6b07`.

The executable was extracted without running the installer or the desktop app:

1. Downloaded the upstream `Stellaris-Companion-Setup-1.1.1.exe` release asset.
2. Verified its SHA-256 against the GitHub release asset digest:
   `7b080c8b576d343668f036f0c9c91a224ee0a9e8f2d0f42266d6f2487f14503d`.
3. Opened the NSIS archive and its embedded `app-64.7z` with 7-Zip.
4. Extracted only `resources/rust-parser/stellaris-parser.exe` into this vendor directory.

`src/save-observer.mjs` is a new Node adapter using the parser's read-only
`serve --path <save>` JSON-lines protocol. Its field mappings were checked against
upstream `stellaris_save_extractor/{player,economy,technology,base,colony_resolver}.py`.
It requests only the selected human player's country and referenced entities,
then projects an explicit output allowlist. It does not expose the full save,
other countries, unexplored stars, or the original app's galaxy-wide analysis.

Missing fields remain `null` or are described by warnings. A save's actual meta
version is returned separately from the currently installed game version. A
successful read of an older save does not verify compatibility with a new patch.

The parser's upstream source records its Rust dependencies in
`stellaris-parser/Cargo.toml` and `Cargo.lock`; this executable is reused as
published, without recompiling or modifying it.
