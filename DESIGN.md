---
name: Violet Folders Electron surface
description: Purple fluid-glass capsules with transparent desktop gaps and a readable solid settings menu
colors:
  ink: '#FAF5FF'
  secondary: '#D6C7E5'
  violet: '#DCBAFF'
  folder-name: '#F5E9FF'
  parent-path: '#DFCFEA'
  menu-surface: '#21192C'
  menu-hover: '#42304F'
  menu-ink: '#FCF6FF'
  focus: '#EFDAFF'
typography:
  ui:
    fontFamily: 'Segoe UI Variable, Microsoft YaHei UI, Segoe UI, sans-serif'
  folder-name:
    fontSize: 15
    fontWeight: 600
    lineHeight: 1.15
  parent-path:
    fontSize: 11
    lineHeight: 1.15
  pin-label:
    fontSize: 9
spacing:
  shelf-max-width: 504
  shelf-padding: '8px 12px 10px'
  row-height: 72
  row-gap: 10
  row-extent: 82
  row-radius: 36
  header-width: 266
  header-height: 46
  header-radius: 25
  header-bottom-gap: 12
  menu-width: 266
  menu-radius: 18
---

# Violet Folders Electron surface

This compact Operate surface helps a user return to a folder while working in other Windows apps. The visual direction is the user's purple and black liquid glass: separate capsule rows, a substantial rounded rim, soft frosting, and clear desktop between rows. The main implementation is React inside an Electron transparent, frameless window. Earlier WPF source is preserved separately and does not define this renderer's tokens.

## Material

The renderer uses rdev/liquid-glass-react for each header or folder capsule. The current component settings are `mode="standard"`, `cornerRadius={36}`, `displacementScale={48}`, `blurAmount={0.1}`, `saturation={125}`, `aberrationIntensity={1.2}`, and `elasticity={0}`. The zero elasticity keeps the glass aligned with its scroll viewport and avoids edge clipping during pointer motion. Header CSS overrides the capsule radius to 25px. All CSS eight-digit colors below are RRGGBBAA, rather than WPF ARGB.

The base fill is a 126-degree gradient: `#6F5486B8` at 0%, `#372642BA` at 31%, `#20132DB8` at 67%, `#68517E76` at 100%. The denser first stop keeps names and paths readable over light desktop windows. A `#E3CEF359` border, inset upper reflection, and lower reflection create the liquid edge. A second inset outline sits 3px inside the rim. The library supplies the curved displacement and reflected highlights. The shared window, document, and gaps remain transparent.

CSS filters work on Chromium content; they do not directly sample unrelated apps behind the native window. The renderer therefore makes no promise of arbitrary desktop refraction or a system-level frosted backdrop. Browser-only previews use a clearly separate backdrop to inspect the material, with fixture folders rather than live Explorer data.

### CSS paint inventory

These authored colors in `renderer/style.css` extend the core tokens above. Alpha values belong to the optical layers and interaction states. They are intentional material paints, rather than extra opaque theme surfaces. Shorthand CSS white and black are normalized here to six digits; `#FFF7` is `#FFFFFF77`.

| Role | CSS colors |
| --- | --- |
| Core text and violet | `#FAF5FF`, `#D6C7E5`, `#DCBAFF` |
| Glass tint stops | `#6F5486B8`, `#372642BA`, `#20132DB8`, `#68517E76` |
| Glass rim and inset outline | `#E3CEF359`, `#FFFFFF77`, `#E2CAFF42` |
| Glass inset light and lower reflection | `#FFFFFF4D`, `#B999E633` |
| Glass elevation shadow | `#0D071126` |
| Brand mark and reflected tint | `#E4CBFF`, `#DAB8FF24` |
| Header count and action ink | `#DCCBE9`, `#EBDDF7` |
| Action hover, selected, and close hover | `#D6B3FB28`, `#DBA1C438` |
| Folder hover, icon, and open dot | `#E1C4FF0C`, `#E4CFF8`, `#D6B1F5` |
| Folder name and parent path | `#F5E9FF`, `#DFCFEA` |
| Name and path text shadows | `#160E24A6`, `#160E2480` |
| Pin text and hover | `#DCC6EF`, `#DEC4FA1C` |
| Pinned gradient, inset light, and text | `#D3A8F747`, `#BD8DE129`, `#F5DEFF20`, `#F6E7FF` |
| Opaque menu, border, ink, and hover | `#21192C`, `#80628F`, `#FCF6FF`, `#42304F` |
| Menu shadow, title, icons, divider, and help | `#100B154D`, `#CDB9DF`, `#D6BEE9`, `#C9ABD526`, `#CDB9DD` |
| Shortcut text and key surface | `#DDC9EC`, `#B094C016` |
| Toggle off, thumb, and on | `#5C4B69`, `#C5B6D1`, `#A16AC3` |
| Notice surface, border, and ink | `#261B33F5`, `#A888BD80`, `#F3E7FA` |
| Focus, selection, and scrollbar | `#EFDAFF`, `#A77BCB55`, `#AD8CC270` |
| Browser preview background | `#8272AA`, `#37293E`, `#17111E`, `#635677`, `#1E1825` |
| White / black utilities | `#FFFFFF`, `#000000` |

## Hierarchy and layout

The shelf is at most 504px wide including 12px horizontal padding. Each folder capsule is 72px tall with a 36px radius; its 82px outer slot leaves a 10px transparent gap. The path is two lines: a 15px semibold final folder name in `#F5E9FF`, and an 11px parent path in `#DFCFEA`, separated by 6px. Each line truncates independently; the button tooltip contains the complete path. A consistent Lucide folder icon distinguishes the navigation target, and a small dot marks an open folder.

The pin control has an icon plus a 9px label. It reads 固定 / Pin before pinning and 常驻 / Kept afterward. The pinned state adds a tinted fill and uses `aria-pressed`; it remains recognizable without color alone. The folder name and pin are independent buttons.

The 266 × 46px header contains the mark, short app name, count, collapse, settings, and visible exit. Its drag region excludes button targets. Empty and collapsed states leave the compact header, without a large empty-state card. The folder list scrolls within the available monitor work area.

The settings menu is an opaque `#21192C` surface with light `#FCF6FF` text, a `#80628F` border, and `#42304F` hover treatment. This readability is retained regardless of the desktop behind it. Language, startup, reset position, help copy, shortcut, and exit have separate rows; keyboard focus uses `#EFDAFF`.

## Motion and interaction

New rows enter downward over 380ms with cubic-bezier(.16,1,.3,1), changing opacity .3→1 and translation -10px→0. The entrance avoids scale and filter animation so the glass library's backdrop measurements remain stable. List folding lasts 280ms, and menu entry lasts 160ms. The `prefers-reduced-motion` media query disables transitions and animations.

Pointer activity is passed to Electron through a narrow preload API so transparent gaps can forward input to the underlying app. Folder rows, header, menu, and notices remain interactive. Hover, visible keyboard focus, loading, errors, open/closed, and pin states have explicit treatments. Escape first closes the menu, otherwise folds the list; Ctrl+Alt+F folds or unfolds globally.

## Verification boundaries

The renderer, preload bridge, Electron window, and live Explorer watcher must be checked together for application behavior. Browser preview verifies layout and the liquid-glass component but cannot establish live folder monitoring, native click-through, or topmost behavior. Backend tests run through `npm test`; production packages come from `npm run dist` into `release/`.

The React component lives in `renderer/App.tsx`; `renderer/main.tsx` mounts it once, and `renderer/style.css` owns the visual tokens. Vite configuration lives in `vite.config.mts`. The native window and lifecycle entry point is `electron/main.cjs`.

`docs/images/preview.png` is a 560 × 360 browser capture of the actual renderer with example paths. It is illustrative UI evidence, not a capture of a user's live Explorer paths. Desktop material appearance depends on the content behind the transparent window.
