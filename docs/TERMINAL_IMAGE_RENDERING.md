# Terminal Image Rendering Notes

This note records the current image-rendering state, native terminal protocol choices, and constraints for future multiplexer work.

## Current Status

Inline document images are safe but not native terminal images.

- Confluence `ac:image` storage maps to canonical `ImageBlock` values.
- Rendered Markdown includes visible image placeholders plus `confluence-opaque` markers so edit/write-back does not silently drop images.
- Explicit sync caches Confluence attachment bytes through the authenticated attachments API and REST download links.
- `media_assets` rows connect image placeholder node ids to cached files.
- The TUI decodes cached PNG and JPEG files, and safely rasterizes accepted SVG files locally.
- Inline TUI previews render cached PNG, JPEG, and SVG raster output as truecolor half-block cells.
- SVG input is limited to 2 MiB, 4096px per source dimension, 16 megapixels of source area, and a 1024px/1 megapixel raster output budget.
- `foreignObject` HTML is stripped before rasterization because resvg does not render it. SVGs with DOCTYPE or ENTITY declarations, executable or embedded-document elements, external/embedded resource references, or CSS resource references are rejected before rendering.
- Missing cache files, URL images, rejected SVGs, and other unsupported formats still show placeholders.
- The explicit `i` image viewer can use native terminal protocols when the direct terminal reports support.
- Inline document images remain cell-based even when native protocols are available.

## Current Code Paths

- `src/confluence/html.ts` parses `ac:image` and extracts attachment filenames or URL references.
- `src/document/model.ts` defines `ImageBlock`.
- `src/document/projection.ts` renders visible image placeholders and exposes `documentImages(...)` for sync.
- `src/sync.ts` caches attachment images during explicit sync and records `MediaAsset` rows.
- `src/index/schema.ts` contains schema v9 `media_assets`.
- `src/index/repository.ts` persists and reads media assets.
- `src/media/image.ts` decodes cached PNG/JPEG files and uses `@resvg/resvg-js` to rasterize validated SVG files into bounded RGBA/grayscale buffers plus PNG bytes for native viewers.
- `src/tui/media.ts` splits rendered Markdown into text and image parts by `confluence-opaque` node id.
- `src/tui/app.tsx` renders image cards, chooses an `ImageRenderMode`, draws cell previews, and manages the native image viewer lifecycle.
- `src/tui/kitty.ts` contains Kitty graphics helpers. The viewer prefers direct cached-PNG payloads (`f=100`) and keeps raw RGBA plus file-transfer helpers for fallback/experiments.
- `src/tui/iterm2.ts` contains OSC 1337 inline image helpers for WezTerm/iTerm2-compatible terminals.
- `src/tui/sixel.ts` contains an indexed-color Sixel encoder for terminals that report Sixel support.

## Root Causes From The Investigation

### Initial `No cached image file` Cause

The first sync-side cache attempt used Confluence's stable web download path:

```text
/wiki/download/attachments/{pageId}/{filename}
```

That path returned `401 Unauthorized` with API-token auth. Sync intentionally swallowed media-cache failures so page sync could still complete, leaving `media_assets.cache_path` empty. The fix resolves attachments through:

```text
/wiki/api/v2/pages/{pageId}/attachments
```

Then it downloads the returned REST link, for example:

```text
/wiki/rest/api/content/{pageId}/child/attachment/{attachmentId}/download
```

### Grayscale Preview Cause

The first visible preview used OpenTUI's grayscale supersampled buffer. It produced unreadable `$`-style ramp output for screenshots and diagrams. The current fallback now uses averaged RGBA pixels and Unicode half-block cells, which is still approximate but safer and more readable.

### Frame Overflow Cause

The image card reserved one row too few for the preview plus borders/header rows. The preview rendered into the bottom border. The card now reserves the missing row and uses the card inner width for the preview buffer.

### Native Kitty Crash Cause

The native Kitty attempt emitted Kitty graphics escape sequences directly into the active OpenTUI output stream. In pure Kitty, some image data could be consumed, but the app was still unstable. In multiplexers such as tmux/herdr, the raw base64 payload was printed as normal text and corrupted the TUI.

Specific problems:

- The first implementation uploaded full RGBA image payloads from the render/frame path.
- Large images produced megabyte-scale base64 payloads per image.
- Re-emitting payloads during OpenTUI frames risks interleaving with OpenTUI's normal renderer output.
- Native terminal images are not part of OpenTUI's cell buffer, so scroll/resize/repaint lifecycle must be handled separately.
- Multiplexers require explicit Kitty graphics passthrough support and often need wrapping that is different from direct Kitty output.
- Capability detection alone is not sufficient proof that the whole output path will consume the protocol safely.
- The current viewer now prefers direct cached PNG payloads for Kitty-compatible terminals, suppresses duplicate native writes, cancels pending writes on close, and bounds decoded-image cache growth.

## Terminal Protocol Reality

Different terminals expose different image mechanisms. They are not interchangeable.

- Kitty and Ghostty use Kitty graphics protocol when `kitty_graphics` is reported and no multiplexer is detected.
- WezTerm and iTerm2 use the iTerm2 inline image protocol.
- Sixel is a different protocol and uses the local indexed-color Sixel encoder.
- Windows Terminal is not Kitty. It uses Sixel only if the running terminal reports Sixel support; otherwise it uses the cell fallback.
- Multiplexers such as tmux/herdr/zellij can block, escape, wrap, or print native image protocol bytes unless passthrough is explicitly supported and configured.
- Existing tmux sessions are supported by wrapping native image output in tmux passthrough sequences. The app does not run `tmux set` or modify user tmux settings.
- In tmux, only native image protocol payloads are wrapped. Cursor movement stays unwrapped so tmux can translate pane-local coordinates and the image does not draw into neighboring panes.
- Kitty image deletion is also wrapped as a native protocol payload in tmux so images are cleared when the viewer closes.

## Current Safe Behavior

Inline document rendering should remain cell-based by default.

Recommended fallback order for inline previews:

1. Cached PNG/JPEG decoded successfully, or SVG rasterized successfully: render color half-block cells.
2. Terminal lacks RGB: render mono cell approximation.
3. Missing cache or unsupported file type: render placeholder.

Native protocols must not be auto-enabled inside the scrolling document view until they have a safe lifecycle.

Recommended viewer protocol order:

1. `kitty_graphics` with direct terminal or existing tmux passthrough session and no `WT_SESSION`: Kitty graphics using a cached or generated PNG payload transfer.
2. Known WezTerm/iTerm2 terminal name: OSC 1337 iTerm2 inline image transfer; SVGs use their generated PNG, never raw SVG bytes.
3. `sixel` capability: indexed-color Sixel.
4. RGB terminal: color half-block cells.
5. Non-RGB terminal: mono cell approximation.

For testing protocol-specific behavior, set `LAZYCONFLUENCE_IMAGE_MODE` to one of `kitty`, `iterm2`, `sixel`, `cell-color`, `cell-mono`, or `placeholder`. For example, `LAZYCONFLUENCE_IMAGE_MODE=sixel` forces the Sixel path in WezTerm so it can be compared with the default iTerm2 path.

The Sixel path uses the full native viewer cell region, detected terminal cell pixel size when available, and an expanded 256-color palette. It is still slower than Kitty/iTerm2 because the app must generate and stream a rasterized Sixel payload for each image switch.

When the viewer selects Sixel, the app queries terminal cell size with `CSI 16 t` and parses `CSI 6;<height>;<width>t`. Sixel sizing can be overridden with `LAZYCONFLUENCE_SIXEL_CELL_WIDTH` and `LAZYCONFLUENCE_SIXEL_CELL_HEIGHT`; fallback defaults are `12` and `24`. By default, `LAZYCONFLUENCE_SIXEL_FIT=contain` preserves aspect ratio to keep payloads smaller and avoid overdraw; set `LAZYCONFLUENCE_SIXEL_FIT=stretch` to fill the viewer region even if that changes image aspect ratio. Native Sixel/iTerm2 images are cleared by overwriting the last displayed viewer cell area, since those protocols do not have the Kitty image-delete command. Sixel erasure intentionally includes a small extra margin because terminals may map Sixel pixels to cells differently.

## Recommended Native Image Strategy

Do not re-enable native inline images in the document scrollbox first.

Implement native images in a dedicated image viewer mode first:

- Add a TUI command, for example `i`, to open the selected image in a stable viewer.
- Use the whole terminal or a fixed overlay region instead of a scrolling document card.
- Upload native image data once per image/resize, not every frame.
- Keep a color-cell fallback behind the native viewer.
- Delete/clear native images when closing the viewer.
- Repaint only on viewer open, resize, image change, or zoom/pan.

Remaining future work:

- Run repeated open/close real-terminal smoke tests in Kitty, Ghostty, WezTerm, tmux/herdr, forced WezTerm Sixel, and Windows Terminal.
- Treat Kitty file transfer (`t=f`) as a later optimization only after terminal-specific smoke tests prove the emulator can access and display local file paths reliably.
- Tune Sixel quality/performance after testing in real Sixel-capable terminals.
- Keep Zellij blocked until confirming its required wrapping/config.
- Add media-cache diagnostics and an optional cache-maintenance command.

## Open Questions

- What exact passthrough protocol/configuration does herdr support for Kitty graphics?
- Should the native image viewer suspend OpenTUI while showing an image, or render as a controlled overlay after each frame?
- Should native images become a user-visible config option if any direct terminal remains unstable?
