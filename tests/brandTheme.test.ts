import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const readSource = (path: string) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("modo Dia usa selo azul profundo com marca branca", async () => {
  const css = await readSource("src/index.css");

  assert.match(
    css,
    /--accent-glass-tint:\s*linear-gradient\(135deg, rgba\(21,91,196,\.94\).*rgba\(15,76,129,\.90\)/,
  );
  assert.match(css, /--accent-glass-solid:\s*linear-gradient\(135deg, #155BC4 0%, #0F4C81 100%\)/);
  assert.match(css, /--brand-mark:\s*#FFFFFF/);
  assert.doesNotMatch(css, /rgba\(7,11,20,\.90\).*rgba\(20,28,46,\.82\)/);
});

test("modo Noite usa ciano contido e brilho reduzido", async () => {
  const css = await readSource("src/index.css");

  assert.match(
    css,
    /--accent-glass-tint:\s*linear-gradient\(135deg, rgba\(59,158,255,\.58\).*rgba\(35,174,196,\.46\)/,
  );
  assert.match(css, /--accent-glass-solid:\s*linear-gradient\(135deg, #3B9EFF 0%, #23AEC4 100%\)/);
  assert.match(css, /--accent-glass-glow:\s*rgba\(59,158,255,\.32\)/);
  assert.match(css, /--accent-glass-quiet-glow:\s*rgba\(59,158,255,\.24\)/);
});

test("rail e Assistente IA compartilham o mesmo tratamento da marca", async () => {
  const [rail, commandBar, shell] = await Promise.all([
    readSource("src/experience/ManualRail.tsx"),
    readSource("src/experience/CommandBar.tsx"),
    readSource("src/experience/ExperienceShell.tsx"),
  ]);

  assert.equal((rail.match(/cr-glass-accent/g) ?? []).length, 2);
  assert.equal((commandBar.match(/cr-glass-accent(?=[\s"])/g) ?? []).length, 2);
  assert.equal((shell.match(/cr-glass-accent/g) ?? []).length, 1);
  assert.doesNotMatch(rail, /background:\s*'var\(--accent-gradient\)'/);
  assert.doesNotMatch(commandBar, /cr-brand-mark[^\n]*opacity-70/);
  assert.match(commandBar, /cr-glass-accent cr-glass-accent-quiet[^\n]*w-12 h-12/);
});
