# Terminal Image Rendering Notes

This note records the current image-rendering state, the root cause of the failed native Kitty attempt, and constraints for future Kitty/Sixel/Windows Terminal work.

## Current Status

Inline document images are safe but not native terminal images.

- Confluence `ac:image` storage maps to canonical `ImageBlock` values.
- Rendered Markdown includes visible image placeholders plus `confluence-opaque` markers so edit/write-back does not silently drop images.
- Explicit sync caches Confluence attachment bytes through the authenticated attachments API and REST download links.
- `media_assets` rows connect image placeholder node ids to cached files.
- The TUI currently decodes cached PNG files only.
- Inline TUI previews render cached PNGs as truecolor half-block cells.
- Missing cache files, URL images, JPEG, SVG, and other unsupported formats still show placeholders.
- Native Kitty protocol code exists, but native output is guarded and not the default.

## Current Code Paths

- `src/confluence/html.ts` parses `ac:image` and extracts attachment filenames or URL references.
- `src/document/model.ts` defines `ImageBlock`.
- `src/document/projection.ts` renders visible image placeholders and exposes `documentImages(...)` for sync.
- `src/sync.ts` caches attachment images during explicit sync and records `MediaAsset` rows.
- `src/index/schema.ts` contains schema v9 `media_assets`.
- `src/index/repository.ts` persists and reads media assets.
- `src/media/image.ts` decodes cached PNG files into RGBA/grayscale buffers.
- `src/tui/media.ts` splits rendered Markdown into text and image parts by `confluence-opaque` node id.
- `src/tui/app.tsx` renders image cards, chooses an `ImageRenderMode`, and draws color-cell or mono-cell previews.
- `src/tui/kitty.ts` contains Kitty graphics protocol encoding helpers, but the TUI does not enable native output by default.

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

- The implementation uploaded full RGBA image payloads from the render/frame path.
- Large images can produce hundreds of kilobytes of base64 payload per image.
- Re-emitting payloads during OpenTUI frames risks interleaving with OpenTUI's normal renderer output.
- Native terminal images are not part of OpenTUI's cell buffer, so scroll/resize/repaint lifecycle must be handled separately.
- Multiplexers require explicit Kitty graphics passthrough support and often need wrapping that is different from direct Kitty output.
- Capability detection alone is not sufficient proof that the whole output path will consume the protocol safely.

## Terminal Protocol Reality

Different terminals expose different image mechanisms. They are not interchangeable.

- Kitty uses Kitty graphics protocol.
- Sixel is a different protocol and needs a Sixel encoder/converter.
- Windows Terminal is not Kitty. If it exposes Sixel in a given version/configuration, a Sixel renderer may work later; otherwise it should use the cell fallback.
- Multiplexers such as tmux/herdr/zellij can block, escape, wrap, or print native image protocol bytes unless passthrough is explicitly supported and configured.

## Current Safe Behavior

Inline document rendering should remain cell-based by default.

Recommended fallback order for inline previews:

1. Cached PNG decoded successfully: render color half-block cells.
2. Terminal lacks RGB: render mono cell approximation.
3. Missing cache or unsupported file type: render placeholder.

Native protocols must not be auto-enabled inside the scrolling document view until they have a safe lifecycle.

## Recommended Native Image Strategy

Do not re-enable native inline images in the document scrollbox first.

Implement native images in a dedicated image viewer mode first:

- Add a TUI command, for example `i`, to open the selected image in a stable viewer.
- Use the whole terminal or a fixed overlay region instead of a scrolling document card.
- Upload native image data once per image/resize, not every frame.
- Keep a color-cell fallback behind the native viewer.
- Delete/clear native images when closing the viewer.
- Repaint only on viewer open, resize, image change, or zoom/pan.

Kitty-specific future work:

- Prefer file-based or compressed PNG transfer over expanded RGBA payloads.
- Use strict checks for direct Kitty vs multiplexer sessions.
- Add explicit tmux/herdr/zellij passthrough handling only after confirming their required wrapping/config.
- Keep native Kitty opt-in until real-terminal smoke tests prove it does not corrupt output.

Sixel-specific future work:

- Add a real Sixel encoder/converter.
- Only enable it when terminal capabilities and runtime checks confirm Sixel support.
- Treat Windows Terminal as Sixel-capable only if the running terminal reports and accepts Sixel.

## Open Questions

- What exact passthrough protocol/configuration does herdr support for Kitty graphics?
- Should the native image viewer suspend OpenTUI while showing an image, or render as a controlled overlay after each frame?
- Should cached JPEG/SVG decoding be implemented before native terminal image work?
- Should native images be an explicit config option rather than environment-only opt-in?
