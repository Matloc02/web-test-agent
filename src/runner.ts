import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { chromium } from "playwright";
import YAML from "yaml";
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
import { TestSchema, Step } from "./schema";

const argv = yargs(hideBin(process.argv))
  .option("test", { type: "string", demandOption: true, describe: "Path to YAML test file" })
  .option("baseUrl", { type: "string", describe: "Override baseUrl in test file" })
  .option("outDir", { type: "string", default: "reports", describe: "Output directory for reports" })
  .option("headless", { type: "boolean", default: true })
  .option("slowMo", { type: "number", default: 0 })
  // Signal handling toggles: when true, do not count these as failures
  .option("ignoreHttpErrors", { type: "boolean", default: false, describe: "Do not fail the run due to HTTP 4xx/5xx responses" })
  .option("ignoreConsoleErrors", { type: "boolean", default: false, describe: "Do not fail the run due to console error messages" })
  .option("ignorePageErrors", { type: "boolean", default: false, describe: "Do not fail the run due to pageerror events" })
  .option("ignoreRequestFailures", { type: "boolean", default: false, describe: "Do not fail the run due to network request failures" })
  .parseSync();

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

async function ensureDir(dir: string) {
  await fsp.mkdir(dir, { recursive: true });
}

async function run() {
  const raw = await fsp.readFile(argv.test, "utf8");
  const parsed = YAML.parse(raw);
  const test = TestSchema.parse(parsed);
  const baseUrl = argv.baseUrl ?? test.baseUrl ?? undefined;
  const tolerate = (test as any).tolerate ?? {};

  if (!baseUrl) {
    throw new Error("No baseUrl provided. Pass --baseUrl or set baseUrl in the YAML test.");
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const testSlug = slugify(test.name);
  const outDir = path.join(argv.outDir, `${testSlug}-${stamp}`);
  await ensureDir(outDir);

  // Collect signals
  const consoleErrors: Array<{ type: string; text: string; location?: any }> = [];
  const pageErrors: string[] = [];
  const requestFailures: Array<{ url: string; method: string; failure: string | null }> = [];
  const httpErrors: Array<{ url: string; status: number; statusText: string }> = [];
  const stepErrors: Array<{ index: number; step: Step; message: string; screenshot?: string }> = [];

  const browser = await chromium.launch({ headless: argv.headless, slowMo: argv.slowMo });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push({ type: msg.type(), text: msg.text(), location: msg.location() });
    }
  });

  page.on("pageerror", (err) => {
    pageErrors.push(String(err));
  });

  page.on("requestfailed", (req) => {
    requestFailures.push({ url: req.url(), method: req.method(), failure: req.failure()?.errorText ?? "unknown" });
  });

  page.on("response", async (res) => {
    const status = res.status();
    if (status >= 400) {
      httpErrors.push({ url: res.url(), status, statusText: res.statusText() });
    }
  });

  function absUrl(p?: string) {
    if (!p) return baseUrl;
    try { return new URL(p, baseUrl).toString(); } catch { return p; }
  }

  async function doStep(i: number, step: Step) {
    try {
      switch (step.action) {
        case "navigate": {
          const target = step.url ?? absUrl(step.path);
          if (!target) throw new Error("navigate requires url or path");
          await page.goto(target, { waitUntil: "networkidle" });
          break;
        }
        case "click": {
          await page.click(step.selector);
          break;
        }
        case "type": {
          await page.fill(step.selector, "");
          await page.type(step.selector, step.text);
          if (step.pressEnter) await page.keyboard.press("Enter");
          break;
        }
        case "fill": {
          await page.fill(step.selector, step.text);
          break;
        }
        case "waitForSelector": {
          await page.waitForSelector(step.selector, { state: step.state ?? "visible", timeout: step.timeoutMs ?? 10000 });
          break;
        }
        case "expectVisible": {
          await page.waitForSelector(step.selector, { state: "visible", timeout: step.timeoutMs ?? 10000 });
          break;
        }
        case "expectText": {
          await page.waitForSelector(step.selector, { state: "visible", timeout: step.timeoutMs ?? 10000 });
          const content = await page.textContent(step.selector);
          if (!content || !content.includes(step.text)) {
            throw new Error(`Expected text \"${step.text}\" in ${step.selector}, got: ${content ?? "<empty>"}`);
          }
          break;
        }
        case "wait": {
          await page.waitForTimeout(step.ms);
          break;
        }
        case "screenshot": {
          const name = step.name ? `${i}-${slugify(step.name)}` : `${i}-screenshot`;
          const p = path.join(outDir, `${name}.png`);
          await page.screenshot({ path: p, fullPage: true });
          break;
        }
      }
    } catch (err: any) {
      const shot = path.join(outDir, `error-step-${i}.png`);
      try { await page.screenshot({ path: shot, fullPage: true }); } catch {}
      stepErrors.push({ index: i, step, message: String(err?.message ?? err), screenshot: shot });
    }
  }

  // Execute steps
  for (let i = 0; i < test.steps.length; i++) {
    await doStep(i + 1, test.steps[i]);
  }

  // Close browser
  await browser.close();

  // Apply tolerate filters (per-test) and CLI ignore flags
  function matchesAnyPattern(text: string, patterns?: string[]) {
    if (!patterns || patterns.length === 0) return false;
    return patterns.some((p) => {
      try {
        const re = new RegExp(p, "i");
        return re.test(text);
      } catch {
        return text.includes(p);
      }
    });
  }

  const filteredHttpErrors = httpErrors.filter((h) => {
    const allowByStatus = Array.isArray(tolerate.httpStatusAllowlist) && tolerate.httpStatusAllowlist.includes(h.status);
    const allowByUrl = matchesAnyPattern(h.url, tolerate.httpUrlAllowlist);
    return !(allowByStatus || allowByUrl);
  });

  const filteredConsoleErrors = consoleErrors.filter((c) => !matchesAnyPattern(c.text, tolerate.consolePatternAllowlist));

  const filteredPageErrors = pageErrors.slice();
  const filteredRequestFailures = requestFailures.slice();

  const pageOk = argv.ignorePageErrors || tolerate.pageErrors || filteredPageErrors.length === 0;
  const consoleOk = argv.ignoreConsoleErrors || tolerate.consoleErrors || filteredConsoleErrors.length === 0;
  const httpOk = argv.ignoreHttpErrors || tolerate.httpErrors || filteredHttpErrors.length === 0;
  const reqOk = argv.ignoreRequestFailures || tolerate.requestFailures || filteredRequestFailures.length === 0;

  // Summarize
  const success = stepErrors.length === 0 && pageOk && consoleOk && httpOk && reqOk;

  const summary = {
    testName: test.name,
    description: test.description ?? null,
    baseUrl,
    timestamp: new Date().toISOString(),
    success,
    counts: {
      stepErrors: stepErrors.length,
      pageErrors: filteredPageErrors.length,
      consoleErrors: filteredConsoleErrors.length,
      httpErrors: filteredHttpErrors.length,
      requestFailures: filteredRequestFailures.length
    },
    stepErrors,
    pageErrors: filteredPageErrors,
    consoleErrors: filteredConsoleErrors,
    httpErrors: filteredHttpErrors,
    requestFailures: filteredRequestFailures
  };

  // Write JSON + Builder Prompt
  const jsonPath = path.join(outDir, `result.json`);
  await fsp.writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf8");

  const promptPath = path.join(outDir, `builder-prompt.md`);
  await fsp.writeFile(promptPath, buildBuilderPrompt(summary), "utf8");

  // Also write a plain-text TL;DR
  const tldrPath = path.join(outDir, `tldr.txt`);
  await fsp.writeFile(tldrPath, buildTLDR(summary), "utf8");

  console.log(`\nReport written to:\n  ${jsonPath}\n  ${promptPath}\n  ${tldrPath}\n  (screenshots inside ${outDir})`);
}

function buildTLDR(s: any) {
  const lines = [
    `Test: ${s.testName}`,
    `Base URL: ${s.baseUrl}`,
    `When: ${s.timestamp}`,
    `Success: ${s.success}`,
    `Counts: step=${s.counts.stepErrors}, page=${s.counts.pageErrors}, console=${s.counts.consoleErrors}, http=${s.counts.httpErrors}, reqFail=${s.counts.requestFailures}`
  ];
  return lines.join("\n");
}

function buildBuilderPrompt(s: any) {
  const reproduction = (s.stepErrors as any[]).map((e, idx) => {
    const step = e.step as Step;
    const nice = JSON.stringify(step, null, 2);
    return `${idx + 1}. Step ${e.index} failed: ${e.message}\n\n<step>${nice}</step>\n${e.screenshot ? `Screenshot: ${e.screenshot}` : ""}`;
  }).join("\n\n");

  const consoleBlock = s.consoleErrors?.length
    ? s.consoleErrors.map((c: any) => `- ${c.text}`).join("\n")
    : "(none)";

  const pageBlock = s.pageErrors?.length
    ? s.pageErrors.map((p: string) => `- ${p}`).join("\n")
    : "(none)";

  const httpBlock = s.httpErrors?.length
    ? s.httpErrors.map((h: any) => `- ${h.status} ${h.statusText} — ${h.url}`).join("\n")
    : "(none)";

  const reqFailBlock = s.requestFailures?.length
    ? s.requestFailures.map((r: any) => `- ${r.method} ${r.url} — ${r.failure}`).join("\n")
    : "(none)";

  return `# Builder Agent — Fix the failing user flow\n\n## Context\n- App base URL: ${s.baseUrl}\n- Function under test (human name): ${s.testName}\n- When: ${s.timestamp}\n- Overall result: ${s.success ? "PASS" : "FAIL"}\n\n## Reproduction Steps & Failures\n${reproduction || "No step errors — see HTTP/console errors below."}\n\n## Runtime Signals\n**Page errors**\n${pageBlock}\n\n**Console errors**\n${consoleBlock}\n\n**HTTP 4xx/5xx responses**\n${httpBlock}\n\n**Network request failures**\n${reqFailBlock}\n\n## Likely Causes — Heuristics\n- Selector timeouts often mean the element never rendered, was hidden behind a condition, or the selector is wrong.\n- 401/403: missing auth, invalid token, or CORS.\n- 404: route mismatch or asset not built.\n- 500: backend error — check server logs for stack traces.\n- Console TypeError/ReferenceError: check component/module imports and client/server boundaries.\n\n## What to Do Next\n1. Reproduce the failure locally by following the steps.\n2. Inspect the failing component(s) and related route/API.\n3. Add or fix tests to cover this flow.\n4. Return a patch diff (or file edits) to resolve errors.\n\n## Deliverables\n- Clear explanation of root cause\n- Code changes to fix\n- Updated test (if applicable)\n- Any migration or config updates\n`;}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
