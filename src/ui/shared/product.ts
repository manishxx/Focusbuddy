/** Product name used in page headings (not user copy; see the message bank). */
export const PRODUCT_NAME = "Focus Buddy";

// TODO(Day 13): move these hard-coded strings into src/core/messages/messages.json
// (and through the banned-phrase lint), then read them via format():
//  - src/ui/shared/product.ts            PRODUCT_NAME "Focus Buddy" (page h1s)
//  - src/ui/sidepanel/App.tsx            PLACEHOLDER_LINE (scaffold placeholder; replace, don't move)
//  - src/ui/{sidepanel,intervention}/index.html  <title>Focus Buddy</title>
//  - src/ui/options/index.html           <title>Focus Buddy settings</title>
//  - src/offscreen/offscreen.html        <title>Focus Buddy audio</title> (not user-visible)
//  - src/manifest.json                   "description"
//  - src/manifest.json                   commands.mute-and-pause.description
//    (manifest strings would need _locales/ + __MSG_*__ to come from a bank)
//  - src/manifest.json                   action.default_title (already equal to bank
//    tooltip.none; check-manifest.mjs enforces this)
