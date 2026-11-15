// Local ESLint rules for Focus Buddy (ADR-0007). No package: loaded by eslint.config.js.
//   fb/chrome-access    chrome.* is used only as direct, non-computed member chains
//   fb/chrome-call-args tabs.create/update, windows.create URLs and executeScript world
//   fb/core-imports     src/core imports only relative modules inside src/core
import path from "node:path";

const ROOT_GLOBAL = "chrome";
const BIND_LIKE = new Set(["call", "apply", "bind"]);
const TYPE_PARENTS = new Set(["TSQualifiedName", "TSTypeReference", "TSTypeQuery", "TSImportType", "TSTypeOperator"]);

/** Unwrap TS-only wrappers that don't change the runtime value. */
function unwrap(node) {
  let n = node;
  while (n && (n.type === "TSNonNullExpression" || n.type === "TSAsExpression" || n.type === "TSSatisfiesExpression"))
    n = n.expression;
  return n;
}

/** ["chrome","tabs","create"] for a non-computed chain rooted at the chrome global, else null. */
function chromeChain(node) {
  const names = [];
  let n = unwrap(node);
  while (n?.type === "MemberExpression") {
    if (n.computed || n.property.type !== "Identifier") return null;
    names.unshift(n.property.name);
    n = unwrap(n.object);
  }
  if (n?.type !== "Identifier" || n.name !== ROOT_GLOBAL) return null;
  return [ROOT_GLOBAL, ...names];
}

const chainIs = (node, ...names) => {
  const chain = chromeChain(node);
  return !!chain && chain.join(".") === [ROOT_GLOBAL, ...names].join(".");
};

function globalRefs(context, program, name) {
  const scope = context.sourceCode.getScope(program);
  const refs = new Set();
  for (const ref of scope.through) if (ref.identifier.name === name) refs.add(ref.identifier);
  const v = scope.set?.get(name);
  if (v && v.defs.length === 0) for (const ref of v.references) refs.add(ref.identifier);
  return [...refs];
}

const chromeAccess = {
  meta: {
    type: "problem",
    docs: { description: "chrome.* must be used as direct, non-computed calls (no aliasing, no indirection)" },
    schema: [],
    messages: {
      computed: "Computed access on chrome.* is not allowed; write chrome.ns.member literally.",
      shallow: "Don't alias or pass chrome or a chrome namespace ({{chain}}); call chrome.ns.member(...) directly.",
      bindLike: "Don't use .call/.apply/.bind on chrome APIs ({{chain}}); call them directly.",
      fnValue: "Don't read the chrome API function {{chain}} as a value; call it directly.",
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    const typed = !!services?.program && typeof services.getTypeAtLocation === "function";
    return {
      "Program:exit"(program) {
        for (const id of globalRefs(context, program, ROOT_GLOBAL)) {
          if (id.parent?.type === "UnaryExpression" && id.parent.operator === "typeof") continue;
          // Type positions (chrome.tabs.Tab, typeof chrome.tabs.get in a type) are not runtime access.
          if (TYPE_PARENTS.has(id.parent?.type)) continue;
          // Walk up the member chain.
          let node = id;
          const names = [];
          let computed = false;
          for (;;) {
            let parent = node.parent;
            while (parent?.type === "TSNonNullExpression" && parent.expression === node) {
              node = parent;
              parent = node.parent;
            }
            if (parent?.type !== "MemberExpression" || parent.object !== node) break;
            if (parent.computed || parent.property.type !== "Identifier") {
              computed = true;
              break;
            }
            names.push(parent.property.name);
            node = parent;
          }
          const chain = [ROOT_GLOBAL, ...names].join(".");
          if (computed) {
            context.report({ node: id, messageId: "computed" });
            continue;
          }
          if (names.length < 2) {
            context.report({ node: id, messageId: "shallow", data: { chain } });
            continue;
          }
          if (names.some((n) => BIND_LIKE.has(n))) {
            context.report({ node: id, messageId: "bindLike", data: { chain } });
            continue;
          }
          let outer = node;
          if (outer.parent?.type === "ChainExpression") outer = outer.parent;
          const isCallee =
            (outer.parent?.type === "CallExpression" || outer.parent?.type === "NewExpression") &&
            outer.parent.callee === outer;
          if (!isCallee && typed) {
            const type = services.getTypeAtLocation(node);
            if (type.getCallSignatures().length > 0)
              context.report({ node: id, messageId: "fnValue", data: { chain } });
          }
        }
      },
    };
  },
};

const isGetURL = (n) => {
  const v = unwrap(n);
  return v?.type === "CallExpression" && chainIs(v.callee, "runtime", "getURL");
};
const propName = (p) =>
  p.type === "Property" && !p.computed
    ? p.key.type === "Identifier"
      ? p.key.name
      : typeof p.key.value === "string"
        ? p.key.value
        : null
    : null;

const TABS_UPDATE_KEYS = new Set(["url", "active", "highlighted"]);

const chromeCallArgs = {
  meta: {
    type: "problem",
    docs: {
      description: "Navigation and injection calls take vetted, literal arguments (SECURITY §6, API_CONTRACTS §4)",
    },
    schema: [],
    messages: {
      literal:
        "{{api}} must be called with an inline object literal (no variables or spreads) so its {{what}} can be checked.",
      url: "{{api}}: url must be chrome.runtime.getURL(...) (extension pages only) or absent.",
      updateKeys:
        "chrome.tabs.update may only set url (via chrome.runtime.getURL), active or highlighted; got {{key}}.",
      world: 'chrome.scripting.executeScript: world must be absent or the literal "ISOLATED".',
    },
  },
  create(context) {
    function objectArg(node, arg, api, what) {
      const obj = unwrap(arg);
      if (obj?.type !== "ObjectExpression" || obj.properties.some((p) => p.type !== "Property" || p.computed)) {
        context.report({ node: arg ?? node, messageId: "literal", data: { api, what } });
        return null;
      }
      return obj;
    }
    function checkUrl(obj, api, allowArray) {
      for (const p of obj.properties) {
        if (propName(p) !== "url") continue;
        const v = unwrap(p.value);
        const ok =
          isGetURL(v) || (allowArray && v.type === "ArrayExpression" && v.elements.every((e) => e && isGetURL(e)));
        if (!ok) context.report({ node: p, messageId: "url", data: { api } });
      }
    }
    return {
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (chainIs(callee, "tabs", "create")) {
          const obj = objectArg(node, node.arguments[0], "chrome.tabs.create", "url");
          if (obj) checkUrl(obj, "chrome.tabs.create", false);
        } else if (chainIs(callee, "tabs", "update")) {
          const arg = node.arguments.length >= 2 ? node.arguments[1] : node.arguments[0];
          const obj = objectArg(node, arg, "chrome.tabs.update", "url");
          if (obj) {
            checkUrl(obj, "chrome.tabs.update", false);
            for (const p of obj.properties) {
              const key = propName(p);
              if (!TABS_UPDATE_KEYS.has(key)) context.report({ node: p, messageId: "updateKeys", data: { key } });
            }
          }
        } else if (chainIs(callee, "windows", "create")) {
          if (node.arguments.length === 0) return;
          const obj = objectArg(node, node.arguments[0], "chrome.windows.create", "url");
          if (obj) checkUrl(obj, "chrome.windows.create", true);
        } else if (chainIs(callee, "scripting", "executeScript")) {
          const obj = objectArg(node, node.arguments[0], "chrome.scripting.executeScript", "world");
          if (!obj) return;
          for (const p of obj.properties) {
            if (propName(p) !== "world") continue;
            const v = unwrap(p.value);
            if (!(v.type === "Literal" && v.value === "ISOLATED")) context.report({ node: p, messageId: "world" });
          }
        }
      },
    };
  },
};

const coreImports = {
  meta: {
    type: "problem",
    docs: { description: "src/core imports only relative modules inside src/core (ADR-0001)" },
    schema: [],
    messages: {
      bare: "src/core may import only relative modules inside src/core, not '{{source}}'.",
      escapes: "src/core may not import '{{source}}': it resolves outside src/core.",
    },
  },
  create(context) {
    const file = context.filename.split(path.sep).join("/");
    const at = file.lastIndexOf("/src/core/");
    if (at < 0) return {};
    const coreDir = file.slice(0, at + "/src/core".length);
    function check(node, source) {
      if (typeof source !== "string") return;
      if (!source.startsWith("./") && !source.startsWith("../")) {
        context.report({ node, messageId: "bare", data: { source } });
        return;
      }
      const resolved = path.posix.resolve(path.posix.dirname(file), source);
      if (resolved !== coreDir && !resolved.startsWith(coreDir + "/"))
        context.report({ node, messageId: "escapes", data: { source } });
    }
    const fromSource = (node) => node.source && check(node, node.source.value);
    return {
      ImportDeclaration: fromSource,
      ExportNamedDeclaration: fromSource,
      ExportAllDeclaration: fromSource,
      ImportExpression(node) {
        check(node, node.source.type === "Literal" ? node.source.value : "(dynamic)");
      },
      TSImportType(node) {
        const lit = node.argument?.literal ?? node.source;
        if (lit?.type === "Literal") check(node, lit.value);
      },
      TSExternalModuleReference(node) {
        if (node.expression?.type === "Literal") check(node, node.expression.value);
      },
    };
  },
};

export default {
  meta: { name: "eslint-plugin-fb" },
  rules: {
    "chrome-access": chromeAccess,
    "chrome-call-args": chromeCallArgs,
    "core-imports": coreImports,
  },
};
