---
name: Vyron
description: A dark glass Klipper interface for the web and the printer screen — the one light of a hot nozzle in the dark.
colors:
  ember-red: "#f03a2e"
  glow-coral: "#ff6b5a"
  frost: "#7cc7ff"
  anodized-black: "#0a0a0b"
  bone-ink: "#f2f4f5"
  ash-dim: "#8a8f98"
  signal-red: "#f03a2e"
  button-hi: "#ff5a4c"
  button-lo: "#e24231"
  on-button: "#121214"
  ok-green: "#34c759"
  warn-amber: "#ff9f0a"
  danger-ink: "#ff8a7e"
  ok-ink: "#8fe3a8"
  warn-ink: "#ffb35c"
  log-ink: "#b9bec6"
  screen-black: "#060607"
  screen-ink: "#f5f5f7"
  screen-dim: "#8e8e93"
  screen-group: "#1c1c1e"
  screen-red: "#ff453a"
  screen-green: "#30d158"
  screen-primary: "#f2f2f4"
  screen-on-primary: "#111113"
typography:
  display:
    fontFamily: "Montserrat, system-ui, sans-serif"
    fontSize: "clamp(70px, 16vw, 130px)"
    fontWeight: 200
    lineHeight: 1
    letterSpacing: "-0.04em"
  readout:
    fontFamily: "Montserrat, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 300
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Montserrat, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Montserrat, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.55
  control:
    fontFamily: "Montserrat, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
  label:
    fontFamily: "Montserrat, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 500
  wordmark:
    fontFamily: "Montserrat, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    letterSpacing: "0.15em"
  mono:
    fontFamily: "ui-monospace, Menlo, Consolas, monospace"
    fontSize: "12px"
    lineHeight: 1.6
  screen-large-title:
    fontFamily: "Montserrat, system-ui, DejaVu Sans, sans-serif"
    fontSize: "2.6rem"
    fontWeight: 700
    letterSpacing: "-0.03em"
  screen-group-header:
    fontFamily: "Montserrat, system-ui, DejaVu Sans, sans-serif"
    fontSize: "1.1rem"
    fontWeight: 500
    letterSpacing: "0.04em"
rounded:
  sm: "8px"
  base: "11px"
  md: "14px"
  lg: "18px"
  xl: "22px"
  pill: "999px"
  screen-sm: "0.8rem"
  screen-base: "1.2rem"
  screen-lg: "1.6rem"
spacing:
  xs: "8px"
  sm: "12px"
  md: "14px"
  lg: "20px"
  edge: "32px"
components:
  button:
    backgroundColor: "rgba(255,255,255,.06)"
    textColor: "{colors.bone-ink}"
    typography: "{typography.control}"
    rounded: "{rounded.base}"
    padding: "9px 14px"
  button-hover:
    backgroundColor: "rgba(255,255,255,.1)"
  button-primary:
    backgroundColor: "{colors.button-lo}"
    textColor: "{colors.on-button}"
    rounded: "{rounded.base}"
    padding: "9px 14px"
  modal-button:
    backgroundColor: "rgba(255,255,255,.06)"
    textColor: "{colors.bone-ink}"
    rounded: "{rounded.base}"
    padding: "12px 10px"
    height: "44px"
  input:
    backgroundColor: "rgba(0,0,0,.28)"
    textColor: "{colors.bone-ink}"
    rounded: "{rounded.base}"
    padding: "9px 14px"
  toggle:
    backgroundColor: "rgba(255,255,255,.14)"
    rounded: "13px"
    width: "44px"
    height: "26px"
  toggle-on:
    backgroundColor: "{colors.ok-green}"
  card:
    backgroundColor: "rgba(255,255,255,.035)"
    rounded: "{rounded.lg}"
    padding: "14px"
  panel:
    backgroundColor: "rgba(18,18,20,.8)"
    rounded: "{rounded.xl}"
    padding: "20px"
  nav-tab:
    textColor: "{colors.ash-dim}"
    rounded: "{rounded.pill}"
    padding: "7px 14px"
  nav-tab-active:
    textColor: "{colors.bone-ink}"
  estop:
    backgroundColor: "{colors.signal-red}"
    textColor: "#ffffff"
    rounded: "17px"
    height: "34px"
    padding: "0 14px"
  screen-tile:
    backgroundColor: "rgba(255,255,255,.07)"
    textColor: "#c7c7cc"
    rounded: "{rounded.screen-base}"
  screen-button-primary:
    backgroundColor: "{colors.screen-primary}"
    textColor: "{colors.screen-on-primary}"
    rounded: "{rounded.screen-base}"
  screen-group:
    backgroundColor: "{colors.screen-group}"
    rounded: "{rounded.screen-base}"
---

# Design System: Vyron

## Overview

**Creative North Star: "A hot nozzle in the dark"**

Vyron is a workshop at night: an almost black background where only what is truly hot or important glows. The brand coral-red light smoulders from a corner of the screen like a heated hotend, and thin tinted glass lies over the 3D print scene like the inspection window of a printer enclosure. The glass edges are lighter at the top and left, darker at the bottom and right, like anodised aluminium. The hexagon grid shows only at the edges, under a vignette.

Web and Screen are one world in two materials. Web is full: real `backdrop-filter`, spring motion, 3D. Screen lives on the CB1's CPU, so its "glass" is faked with a fill and a top highlight, background glows are static gradients, and animations are transform/opacity only, up to ~0.22 s. The theme (accent, brand, glass, radii, grid, glow, language) is shared and synced between them; Screen takes the coefficients (`--glass-t`, `--radius-k`, `--blur-k`, `--glow-k`) and translates them into its rem layout.

Vyron deliberately doesn't look like the dense Material admin of Mainsail/Fluidd, the colourful GTK tiles of KlipperScreen or neon gamer RGB. Glow here always means something.

**Key Characteristics:**
- A dark background with one warm light source (`--glow-k` sets its strength).
- Tinted glass with "anodised" edges over the 3D scene; denser for large panels.
- Large thin figures (Montserrat 200/300) for state: percent, temperatures, coordinates; `tabular-nums` everywhere.
- A coral primary action, neutral glass "pills" for the rest.
- A springy press response (`scale(.96)`), respecting `prefers-reduced-motion`.
- Screen: iOS tidiness — a large title, grouped lists, neutral tiles, a light primary button.

## Colors

An almost black palette with one warm theme voice and a separate, fixed signal red.

### Primary
- **Ember Red** (`ember-red`): the theme's brand colour (`--brand`). Background glow, the highlight under the active tab, the primary button shadow, progress, the VD logo. Changes with the theme preset.
- **Glow Coral** (`glow-coral`): the theme's light accent (`--coral`, `--accent-rgb`). Focus rings, an open `<details>` chevron, the `›` cursor in the console, the active scrollbar thumb, hot temperatures.
- **Button Hi / Lo** (`button-hi` → `button-lo`) and **On Button** (`on-button`): the vertical gradient of the primary action and its text. `theme.js` (`pickButtonText`) picks white or dark text for each theme and nudges the gradient just enough for ≥4.5:1 at both ends and on hover. In "Voron" the text is dark.

### Secondary
- **Frost** (`frost`): cold (`--ice`). A cold nozzle, Klipper `// …` info lines in the console. The only cold counter-note to the coral.

### Neutral
- **Anodized Black** (`anodized-black`): the web background.
- **Bone Ink** (`bone-ink`): primary text.
- **Ash Dim** (`ash-dim`): secondary text, inactive tabs, captions.
- **Log Ink** (`log-ink`): regular console and log text.
- Surfaces are white at low alpha: `--surface` (.035), `--surface-hi` (.06), `--hair` (.06) for dividers, `--field-bg` — black .28 under input fields.
- **Screen Black / Ink / Dim / Group** (`screen-*`): the printer screen palette in the spirit of iOS dark — a slightly deeper background and system greys.

### Semantic
- **Signal Red** (`signal-red`; `screen-red` on Screen): STOP, errors, heat danger. Matches Ember Red only in the "Voron" theme.
- **OK Green** (`ok-green`; `screen-green` on Screen): a switch that is on, success.
- **Warn Amber** (`warn-amber`): warnings and waiting in the error card, notes on Screen.

### Named Rules
**The Semantic Red Rule.** `--red` ignores the theme and is never used for decoration. If the user picks a green theme, STOP and errors are still red.

**The One Ember Rule.** One warm light source per screen: the background glow + one primary action. A second coral button next to it means two primary actions, which means none.

**The Semantic Token Rule.** Semantic colours come only from tokens: `--red-rgb`, `--green` / `--green-rgb`, `--amber-rgb` for fills and glow, `--danger-ink` / `--ok-ink` / `--warn-ink` for text on a dark background. Literals like `rgba(240,58,46,…)` in components are drift.

**The Theme-Derived Rule.** New colour accents come from `--coral` / `--brand` / `--accent-rgb` / `--brand-rgb`, never hard-coded — otherwise they won't follow the theme or sync to Screen.

## Typography

**Display Font:** Montserrat (with system-ui) — a variable font bundled into the build (`@vyron/shared/fonts.css`, Cyrillic + Latin, weights 200–700), no Google Fonts
**Body Font:** Montserrat
**Label/Mono Font:** ui-monospace, Menlo, Consolas — console, logs, config
**Screen Font:** the same Montserrat, bundled into `screen.html` (~83 KB). The system stack is only a fallback: on a CB1 `system-ui` is DejaVu Sans with two weights, and Screen stopped looking like Web

**Character:** Geometric Montserrat in thin weights makes readouts look like instrument scales; denser 500–600 hold the controls. On Screen it's the same Montserrat, bolder and larger: large iOS-like titles that read from a distance next to the printer.

### Hierarchy
- **Display** (200, clamp 70–130px, 1.0, −0.04em): the print percent on the home view. One such figure per screen.
- **Readout** (200–300, 14–28px, ~1.1): temperatures, coordinates, MCU metrics, slider values. Size depends on the space; the weight is always thin.
- **Title** (600, 18px, 1.3): the error card title, dialogs.
- **Body** (400, 13–13.5px, 1.55): descriptions, error explanations.
- **Control** (500, 12px): text of buttons, fields and tabs inside panels.
- **Label** (500, 11px): row captions, `muted`, subheadings, tile metadata. The smallest text is 10px, only for short uppercase badges (CAN, EDDY).
- **Wordmark** (600, 0.15em; the VYRON letters — 0.24em): the header logo only.
- **Screen Large Title** (700, 2.6rem, −0.03em) and **Group Header** (500, 1.1rem, uppercase, 0.04em) — Screen settings pages. Metadata and captions on Screen are at least 1.15rem (11.5px on the TFT35); uppercase badges at least 1.05rem.

### Named Rules
**The Thin Numbers Rule.** Every live number uses a thin weight (200–300) and `tabular-nums` so it doesn't "jump" on update. Figures are never bold.

**The One Face Rule.** Web and Screen speak one font — Montserrat, bundled into the build. Don't rely on the device's system font: it differs on every board.

## Layout

**Web.** The 3D print scene fills the screen; the UI floats over it. The header is fixed (`top: 20px`, 32px margins): the word mark, a glass tab "track", actions (E-stop). Tabs open as one large glass panel `.view` — from the header to the bottom with 32px margins, `padding: 20px`, `gap: 14px`, 22px radius, internal scrolling. Inside — cards (`.card`, padding 14px) and iOS-style grouped lists (`.group`, 12×14px rows with hairline dividers). Dialogs are centred, `min(380px, 92vw)` wide.

Breakpoints: ≤1100px — more compact tabs (designed for 1024×600); ≤900px — 10–16px margins and an 18px panel radius (800×480, phones). Phones and foldables get a separate mobile mode (iOS-like Control; two panes on an unfolded Fold). The theme scale (85–120%) is `zoom` on the root; enlarging is enabled only from 1280px wide, because 1024×600 and 800×480 are laid out edge to edge.

**Screen.** `1rem = min(100vw/48, 100vh/32)` — 10px on the 480×320 TFT35, 15px on 800×480, 18.75px on 1024×600; every size is in rem. A 4.6rem top bar, below it a page with drag scrolling (`dragScroll.js`; native scrolling is off because of resistive touch). Settings pages: 1.4rem margins, a large title, groups spaced by 1.4rem.

**The Finger Rule.** On touch screens (`@media (pointer: coarse)`) buttons and fields in panels are at least 40 px tall, tabs 36 px, small icon buttons get a 44 px hit area (an invisible pseudo-element extension when the container doesn't clip). With a mouse the UI stays compact. On narrow phones tabs take width by their name, not equal shares — names are never cut.

**The Edge-to-Edge Budget Rule.** On 1024×600 and 800×480 every pixel is accounted for — check any new header or panel element at these sizes, not just on a desktop.

## Elevation & Depth

Depth in Vyron is glass over the scene, not stacks of cards. Levels: the background with grid and glow → the 3D scene → the glass header/panel → cards (a lighter surface with a hairline border, no shadow) → dialogs (the strongest shadow, a dimmed and blurred backdrop).

### Shadow Vocabulary
- **Glass edge** (`box-shadow: 0 1px 0 rgba(255,255,255,.04) inset, 0 18px 40px -18px rgba(0,0,0,.7)` + a border: lighter top/left `.08`, darker bottom/right `.02`): every glass surface of the web.
- **Modal lift** (`0 30px 60px -20px rgba(0,0,0,.8), inset 0 1px 0 rgba(255,255,255,.05)`): dialogs, the error card.
- **Ember under-glow** (`0 4px 14px -6px rgba(var(--brand-rgb), .8)` + `inset 0 1px 0 rgba(255,255,255,.25)`): only the primary action and the E-stop.
- **Screen glass** (`inset 0 1px 0 rgba(255,255,255,.07)`, no blurred shadows): every Screen surface.

### Named Rules
**The Glass-Over-Scene Rule.** Glass always has a fallback without `backdrop-filter` — an almost opaque background so text reads over any 3D scene. A larger surface means denser glass.

**The Screen Has No Blur Rule.** No `backdrop-filter`, blurred shadows or endless animations on Screen — "glass" is only a fill and a top highlight.

## Shapes

Soft but not puffy corners that scale together (the theme changes every radius with one 0–160% coefficient): 8px small elements, 11px buttons and fields, 14px, 18px cards and groups, 22px large panels and dialogs. Tabs and the E-stop are full pills. Borders are always 1px hairlines, white at .06–.08 alpha. Switches are 44×26 iOS pills. The logo is the VD monogram (a D silhouette with a cut-out V). The hexagon is a background motif (a 56×97 grid), not an element shape.

## Components

### Buttons
Glass "pills" with a spring press.
- **Shape:** 11px (`--r`).
- **Default:** a `--surface-hi` surface with a hairline border, Control 12px text.
- **Primary:** a vertical Button Hi → Lo gradient, `--on-button` text (dark or white by contrast, ≥4.5:1), 600, a warm under-glow. One per panel.
- **Hover / Active / Focus:** a lighter surface (.1) and border (.14); press — `scale(.96)` on the `--spring` (0.5 s); focus — a 2px `--coral` outline with a 2px offset.
- **Disabled:** opacity .35, `not-allowed`.
- **Modal:** the same, but 13px and at least 44px tall — finger-sized.

### Cards / Containers
- **Panel (`.view`):** 22px glass, padding 20px; one per tab.
- **Card:** `--surface`, a `--hair` border, 18px, padding 14px, no shadow.
- **Group:** an iOS list, 12×14px rows, `--hair` dividers.
- **Details:** an 18px disclosure block with its own chevron that springs around and turns coral when open.

### Inputs / Fields
- **Style:** darker than the surface (`--field-bg`), a `--field-bd` border, 11px. Number fields have no native arrows — −/+ or presets instead.
- **Focus:** no outline; the border turns coral (.7) with a `0 0 0 3px rgba(accent, .2)` halo.
- **Toggle:** a 44×26 iOS switch, green when on, the knob moves on a spring.
- **Select:** a custom chevron arrow.

### Navigation
A glass pill track with 12px tabs, inactive ones in Ash Dim. One moving highlight "pill" springs under the active tab; below it a short 16×2px Ember Red line with a glow. At ≤1100px tabs are more compact; the track scrolls horizontally without a scrollbar.

### E-stop
A red pill (a Signal Red gradient `#ef3b2f → #c4231a`), 34px, 11px 700 with .1em tracking. During a print its glow slowly "breathes" (3.6 s). The only endless animation on the web, and a justified one: it's the emergency button.

### Klipper Error Card
Vyron's signature — "what / why / what to do". A centred card up to 520px over a dimmed (.55) and blurred scene; a thin 3px strip of the tone colour on top (red — error, amber — warning/waiting, green — ok). A 42px icon badge in the tone colour on a .12 background, a Title 18px heading, a Body description. Colour only in the strip and badge; the card itself is neutral, no pulsing.

### Console / Log
Mono 12px/1.6 in a dark well (`rgba(0,0,0,.32)`, an inner shadow), 18px. A sent command — Bone Ink 600 with a coral `›`; Klipper info — Frost; an `!!` error — `#ff7a6e`; ok — `#8fe3a8`.

### Screen Tiles & Groups
Neutral tiles (`--tile` .07, icons `#c7c7cc`), a 1.2rem radius; colour appears only where it means something (heat, error). The primary action on Screen is a **light** button (`screen-primary` with dark text), not a coral one. Touch feedback — 0.1 s `scale(.96)` + brightness 1.2; while drag-scrolling the button under the finger isn't pressed. Pages transition with a slide in the navigation direction (30% / −12%, 0.22 s).

## Do's and Don'ts

### Do:
- **Do** take accents from the theme tokens (`--coral`, `--brand`, `--accent-rgb`, `--brand-rgb`, `--btn-*`) so new things follow the theme and sync to Screen.
- **Do** keep live numbers in a thin weight (200–300) with `tabular-nums`.
- **Do** give every glass surface a fallback without `backdrop-filter`.
- **Do** use the `--spring` (0.5 s) for presses and appearance, `--ease-out` with `--t-fast` (0.18 s) / `--t-mid` (0.32 s) for colour and opacity; respect `prefers-reduced-motion`.
- **Do** check Web at 1024×600 and 800×480, Screen at 480×320.
- **Do** keep everything in rem on Screen and animate only transform/opacity.

### Don't:
- **Don't** use `--red` / Signal Red for decoration or branding — only STOP, errors, danger.
- **Don't** go neon or gamer RGB: glow everywhere, coloured gradient text, coloured outlines for effect. Glow is only a signal (theme, primary action, E-stop). The only gradient allowed on text is the neutral "anodised" grey on the Display print percent.
- **Don't** slide into the Material/Vuetify admin of Mainsail/Fluidd: dense tables, system controls, a grid of identical dashboard cards.
- **Don't** put colourful KlipperScreen-style GTK tiles with icons on Screen — tiles are neutral, colour only with meaning.
- **Don't** put two coral primary actions on one panel.
- **Don't** add blur, blurred shadows, network fonts, 3D or looping animations to Screen.
- **Don't** add endless animations to the Web, except the E-stop during a print and progress indicators.
