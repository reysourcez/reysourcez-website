# Theme Guide — changing the whole site's look and feel

## The short answer: you can already do this in one place

Every color on every page is already a named CSS variable, defined once in `styles.css`, section 1 (`:root { ... }`). Since every page loads the same `styles.css`, changing a value there changes it on every page simultaneously — there's no per-page repetition to fight with. That's the mechanism; the rest of this doc is the reference table and two ready-made examples so changing it doesn't mean guessing which of nine names is the right one.

## Token reference (current values, as of 2026-09-20)

| Token | Current value | What it controls |
|---|---|---|
| `--ink` | `#16261F` | Headings, nav text, footer background — the darkest color on the site |
| `--text` | `#1C2B24` | Body copy |
| `--muted` | `#5C6D64` | Secondary / quieter text (captions, helper notes) |
| `--paper` | `#EEF0EA` | Page background |
| `--surface` | `#FFFFFF` | Card backgrounds |
| `--accent` | `#1F6F5C` | The signature teal — links, buttons, icons, anywhere the brand color shows |
| `--accent-dark` | `#195A4A` | `--accent`, darkened, for hover states |
| `--accent-soft` | `#DCEAE4` | Pale tint of `--accent`, for soft/tinted blocks |
| `--line` | `#D8DCD3` | Hairline borders and dividers |
| `--font-display` | `"Fraunces", Georgia, serif` | Headings |
| `--font-body` | `"IBM Plex Sans", -apple-system, BlinkMacSystemFont, sans-serif` | Body text |

**Change the whole site's core palette:** edit these nine color values inside the `:root { }` block at the top of `styles.css`. Nothing else needs touching.

**Left alone on purpose, even in a full reskin:** the per-tool overlay accents (`--menu-accent`, `--overhead-accent`, `--printing-accent` and their `-soft` pairs, styles.css section 15) and the cost-structure segment colors (`--seg-overhead`, `--seg-manpower`, `--seg-margin`). These exist to read as *distinct from* the main accent — Menu Calculator's overlay shouldn't look like the same color as a button — so they're a separate, smaller decision from "what's the site's core color," not something a palette swap should touch automatically.

## Try it now: the Ocean theme (already built, live in styles.css)

A second, ready palette already exists as `[data-theme="ocean"] { ... }`, right after the main `:root` block. To preview it on any single page, add the attribute to that page's opening tag:

```html
<html lang="en" data-theme="ocean">
```

Every element reading `--ink`, `--accent`, and so on switches immediately — no other change needed. Remove the attribute (or set it back to nothing) to return to the default look. This is currently a manual, per-page, temporary way to preview a theme — see "Going further" below for what a permanent, site-wide switch would take.

| Token | Ocean value |
|---|---|
| `--ink` | `#16212B` |
| `--text` | `#1C2733` |
| `--muted` | `#5C6B78` |
| `--paper` | `#EAF0F2` |
| `--accent` | `#1B5A8A` |
| `--accent-dark` | `#164A70` |
| `--accent-soft` | `#D9E7EF` |
| `--line` | `#D3DCE1` |

## A second ready-made palette: Terracotta (reference only — not yet in styles.css)

A warm alternative, for comparison. Not wired into `styles.css` yet — paste this block in (same shape as the Ocean one above) if you want to try it:

```css
[data-theme="terracotta"] {
  --ink: #2B1F16;
  --text: #332619;
  --muted: #78685C;
  --paper: #F2ECE5;
  --accent: #B5502E;
  --accent-dark: #8F3E22;
  --accent-soft: #F2DCD1;
  --line: #E1D5C8;
}
```

## Going further: a true one-flip, site-wide switch

Right now, trying a theme means manually adding `data-theme="ocean"` to one page's `<html>` tag — good for previewing, not for actually running the site in a different look, since it'd mean editing that attribute on every page individually (the exact kind of repetition `SITE_CONFIG_STANDARD.md` exists to get rid of elsewhere).

The natural next step: `site-config.js` already has a `theme: 'default'` field sitting ready for this (see `SITE_CONFIG_STANDARD.md`). A small script reading that value and setting `document.documentElement.dataset.theme` accordingly would make theme-switching genuinely site-wide — change one word in one file, every page picks it up.

**Not built yet, on purpose — one honest tradeoff to decide on first:** `site-config.js` loads as a `defer` script, which runs after the page's HTML is parsed but before it's fully interactive. Applying a theme at that point can cause a brief flash of the *default* look before the JS swaps it — usually not very noticeable, but real. Eliminating it entirely needs a tiny non-deferred script placed directly in each page's `<head>`, which is slightly more plumbing (and one more thing every page needs) than the deferred version. Worth deciding which tradeoff you want before building it — say the word either way and this gets built next.

## Going further still: change themes without opening any file at all

Everything above still means opening `styles.css` (or a config file) and editing text. A true "no code, ever" version would be its own small tool — a page, in the same style as the other calculators, with a handful of color pickers that write straight to `site-config.js`'s `theme` field (or generate a custom palette on the fly). That's a bigger, standalone build, not a tweak to something that already exists — flagging it as an option, not assuming it's wanted.
