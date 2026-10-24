# App icon

`icon.png` is the transparent 1024×1024 source used for the development Dock icon. `icon.icns` contains 16–1024 pixel representations for the packaged macOS app. Both files are committed so cloning and packaging do not require image generation.

To rebuild the ICNS file on macOS after replacing the PNG:

```sh
npm run build:icon
```

The source artwork was generated with the built-in ImageGen tool, then resized and packaged using macOS `sips` and the icon build script. Generation prompt:

> Use case: logo-brand. Create one finished macOS application icon for Y-Term, a focused local terminal app. Square 1024 x 1024 composition. A single substantial rounded-square charcoal tile with restrained depth, very subtle inset border and refined soft highlight. On the tile, a bold, beautifully balanced mint-green geometric capital Y, its two upper strokes subtly evoking terminal prompt chevrons, paired with a short mint-green underscore cursor at the lower right of the Y. Minimal professional developer tool aesthetic, precise clean edges, strong silhouette, excellent legibility down to 32 pixels. Tile centred with normal macOS app icon transparent outer margins (roughly 9% each edge); outside the tile is genuinely transparent. Front facing, no perspective, no mockup, no surrounding objects. No wordmark, no small text, no Electron atom, no extra symbols, no watermark. Dark graphite and the app's soft mint #a6e3a1.

The current artwork uses a subsequent built-in ImageGen edit of that source:

> Edit the provided Y-Term macOS app icon. Change only the size and position of its mint-green Y and underscore cursor emblem: scale the entire Y-plus-underscore emblem down to about 45% of its current width and height, and place this smaller emblem in the bottom-left quadrant of the charcoal tile, with comfortable equal optical padding from the tile's left and bottom edges (about 13% of the tile width). The emblem should clearly read as a small Y_ at the bottom left, leaving generous empty charcoal space above and to the right. Preserve the existing exact Y shape, its mint material and colour, and keep the underscore beside the Y at the same relative scale. Preserve the charcoal rounded-square tile, subtle inset border, lighting, bevel, outer margins and transparent background exactly. Do not recenter the emblem, do not change anything else, no added text or symbols. Square app-icon asset, 1024 x 1024 composition.
