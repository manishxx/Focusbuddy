/**
 * src/core/tsconfig.json has no DOM, worker or chrome types, so browser and
 * extension globals do not type-check in core at all (Day 05 review F2).
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const coreDir = fileURLToPath(new URL("../../src/core/", import.meta.url));

function diagnosticsFor(code: string): string[] {
  const configPath = join(coreDir, "tsconfig.json");
  const read = ts.readConfigFile(configPath, (p) => ts.sys.readFile(p));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(configPath));
  const probe = join(coreDir, "__tsconfig_probe__.ts");
  const host = ts.createCompilerHost(parsed.options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, lang, onError, create) =>
    name === probe ? ts.createSourceFile(name, code, lang) : getSourceFile(name, lang, onError, create);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (name) => name === probe || fileExists(name);
  const program = ts.createProgram([probe], parsed.options, host);
  return ts
    .getPreEmitDiagnostics(program, program.getSourceFile(probe))
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

describe("src/core tsconfig", () => {
  it.each(["chrome.runtime.id", 'fetch("/x")', "window", "document", "self", "navigator", "XMLHttpRequest"])(
    "rejects %s",
    (expr) => {
      const messages = diagnosticsFor(`export const x = () => ${expr};`);
      expect(messages.join("\n")).toMatch(/Cannot find name/);
    },
  );

  it("accepts plain ES code", () => {
    expect(
      diagnosticsFor(`export const x = (n: number): string => new Intl.Segmenter().segment(String(n)) ? "a" : "b";`),
    ).toEqual([]);
  });
});
