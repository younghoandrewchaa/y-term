# Agent instructions

## Keep the website in step with the app

The project website in `site/` is part of every user-visible change. When you add or change a feature, a shortcut, or anything in the app's appearance, update the site in the same change:

- **Content** (`site/index.html`): the feature cards, the keyboard shortcuts table, the hero lede, and the meta description describe the app as it now behaves.
- **Mock** (the `.window` block in the hero): this is the site's screenshot, built in HTML and CSS rather than an image. Make it show the app as it now looks, especially the new feature where it fits. Copy icons from the app's SVGs (`src/renderer/index.html`, `src/renderer/*.ts`) and colours from `src/renderer/styles.css`, so the mock matches the real app. Set `.win-version` to the version in `package.json`.

The site's direction is that Y-Term augments the terminal with icons and custom commands beside your output. Describe new features in those terms.

Done means every site statement still matches the app, and you have rendered the page in both light and dark themes and looked at the mock. For example:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars \
  --window-size=1200,1500 --screenshot=/private/tmp/site.png "file://$PWD/site/index.html"
```

Add `--force-dark-mode --blink-settings=preferredColorScheme=0` for the dark theme.
