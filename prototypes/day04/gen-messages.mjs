// Copies src/core/messages/messages.json into prototypes/day04/messages.js so the prototypes work from file://.
import { readFileSync, writeFileSync } from "node:fs";
const j = JSON.parse(readFileSync("src/core/messages/messages.json", "utf8"));
writeFileSync("prototypes/day04/messages.js", "// GENERATED from src/core/messages/messages.json by gen-messages.mjs. Do not edit.\nwindow.FB_MESSAGES = " + JSON.stringify(j.messages, null, 2) + ";\n");
console.log("wrote messages.js with", Object.keys(j.messages).length, "keys");
