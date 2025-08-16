// SAVE THIS OR NOW.

import React, { useEffect, useMemo, useRef, useState } from "react";
import YAML from "yaml";

// --- Types mirrored from runner schema ---
type NavigateStep = { action: "navigate"; url?: string; path?: string };
type ClickStep = { action: "click"; selector: string };
type TypeStep = { action: "type"; selector: string; text: string; pressEnter?: boolean };
type FillStep = { action: "fill"; selector: string; text: string };
type WaitForSelectorStep = { action: "waitForSelector"; selector: string; state?: "visible"|"hidden"|"attached"|"detached"; timeoutMs?: number };
type ExpectVisibleStep = { action: "expectVisible"; selector: string; timeoutMs?: number };
type ExpectTextStep = { action: "expectText"; selector: string; text: string; timeoutMs?: number };
type WaitMsStep = { action: "wait"; ms: number };
type ScreenshotStep = { action: "screenshot"; name?: string };

type Step =
  | NavigateStep | ClickStep | TypeStep | FillStep
  | WaitForSelectorStep | ExpectVisibleStep | ExpectTextStep
  | WaitMsStep | ScreenshotStep;

type Tolerate = {
  httpErrors?: boolean;
  consoleErrors?: boolean;
  pageErrors?: boolean;
  requestFailures?: boolean;
  httpStatusAllowlist?: number[];
  httpUrlAllowlist?: string[];
  consolePatternAllowlist?: string[];
};

type TestDef = {
  name: string;
  description?: string;
  baseUrl?: string;
  tolerate?: Tolerate;
  steps: Step[];
};

// --- Helper: selector synthesis (prefers data-testid, id, name) ---
function bestSelector(el: Element): string {
  const e = el as HTMLElement;
  if (!e) return "body";
  // Prefer data-testid
  const dt = e.getAttribute("data-testid");
  if (dt) return `[data-testid="${cssEscape(dt)}"]`;
  // Prefer id when present & unique
  if (e.id) return `#${cssEscape(e.id)}`;
  // Inputs by name
  const name = (e as HTMLInputElement).name;
  if (name && e.tagName.toLowerCase() === "input") return `input[name="${cssEscape(name)}"]`;
  // Label buttons/links by text when reasonable
  const tag = e.tagName.toLowerCase();
  if (["button", "a"].includes(tag)) {
    const txt = e.textContent?.trim();
    if (txt && txt.length <= 40) {
      // Use Playwright text selector compatible regex in our runner schema
      const safe = txt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return `text=/${safe}/i`;
    }
  }
  // Fallback: short CSS path using tag + nth-child up to 3 ancestors
  return shortCssPath(e);
}

function shortCssPath(e: Element): string {
  const parts: string[] = [];
  let cur: Element | null = e;
  let depth = 0;
  while (cur && cur.nodeType === 1 && depth < 4) {
    const tag = cur.tagName.toLowerCase();
    let sel = tag;
    if ((cur as HTMLElement).id) {
      sel = `#${cssEscape((cur as HTMLElement).id)}`;
      parts.unshift(sel);
      break;
    }
    const parent = cur.parentElement;
    if (!parent) { parts.unshift(sel); break; }
    const idx = Array.from(parent.children).indexOf(cur) + 1;
    sel += `:nth-child(${idx})`;
    parts.unshift(sel);
    cur = parent;
    depth++;
  }
  return parts.join(" > ");
}

function cssEscape(s: string) {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// --- Bookmarklet source ---
function makeBookmarklet(sessionId: string) {
  const code = `(() => {\n  const sid = ${JSON.stringify(sessionId)};\n  if (!sid) { alert('No session id'); return; }\n  const cfg = { maxText: 40 };\n  const cssEscape = (s) => s.replace(/\\\\/g, "\\\\\\\\").replace(/\"/g, '\\\\"');\n  const shortCssPath = (e) => {\n    const parts = []; let cur = e; let depth = 0;\n    while (cur && cur.nodeType === 1 && depth < 4) {\n      const id = cur.id;\n      if (id) { parts.unshift('#' + cssEscape(id)); break; }\n      const tag = cur.tagName.toLowerCase();\n      const p = cur.parentElement;\n      if (!p) { parts.unshift(tag); break; }\n      const idx = Array.from(p.children).indexOf(cur)+1;\n      parts.unshift(tag + ':nth-child(' + idx + ')');\n      cur = p; depth++;\n    }\n    return parts.join(' > ');\n  };\n  const bestSelector = (el) => {\n    if (!el) return 'body';\n    const dt = el.getAttribute && el.getAttribute('data-testid');\n    if (dt) return '[data-testid="' + cssEscape(dt) + '"]';\n    if (el.id) return '#' + cssEscape(el.id);\n    if (el.tagName && el.tagName.toLowerCase() === 'input' && el.name) return 'input[name="' + cssEscape(el.name) + '"]';\n    const tag = el.tagName ? el.tagName.toLowerCase() : '';\n    if (tag === 'button' || tag === 'a') {\n      const txt = (el.textContent || '').trim();\n      if (txt && txt.length <= cfg.maxText) {\n        const safe = txt.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');\n        return 'text=/' + safe + '/i';\n      }\n    }\n    return shortCssPath(el);\n  };\n  const post = (payload) => {\n    window.postMessage({ type: 'wt-recorder', sessionId: sid, payload }, '*');\n  };\n  const onClick = (e) => {\n    const sel = bestSelector(e.target);\n    post({ kind: 'click', selector: sel });\n  };\n  const onInput = (e) => {\n    const t = e.target; if (!t || !t.tagName) return;\n    const tag = t.tagName.toLowerCase();\n    if (tag !== 'input' && tag !== 'textarea') return;\n    const sel = bestSelector(t);\n    const val = t.type === 'password' ? '***' : String(t.value || '');\n    post({ kind: 'type', selector: sel, text: val });\n  };\n  const onKeydown = (e) => { if (e.key === 'Enter') post({ kind: 'key', key: 'Enter' }); if (e.key === 'Escape') cleanup(); };\n  function cleanup(){\n    document.removeEventListener('click', onClick, true);\n    document.removeEventListener('input', onInput, true);\n    window.removeEventListener('keydown', onKeydown, true);\n    overlay && overlay.remove();\n    post({ kind: 'stopped' });\n  }\n  // Small overlay
  const overlay = document.createElement('div');\n  overlay.style.cssText = 'position:fixed;bottom:12px;right:12px;background:#111;color:#fff;padding:8px 10px;border-radius:10px;font:12px system-ui;z-index:999999;opacity:.9;';\n  overlay.textContent = 'Recording… click/type to capture (ESC to stop)';\n  document.body.appendChild(overlay);\n  document.addEventListener('click', onClick, true);\n  document.addEventListener('input', onInput, true);\n  window.addEventListener('keydown', onKeydown, true);\n})();`;
  return `javascript:${encodeURIComponent(code)}`;
}

// --- YAML generation ---
function toYaml(test: TestDef) {
  // Ensure all selectors with quotes are valid in YAML by using single-quoted strings when needed
  const replacer = (key: string, value: any) => value;
  const doc: any = {
    name: test.name,
    description: test.description,
    baseUrl: test.baseUrl,
    ...(test.tolerate ? { tolerate: test.tolerate } : {}),
    steps: test.steps
  };
  return YAML.stringify(doc);
}

// --- UI ---
export default function WebTestBuilderUI() {
  const [sessionId, setSessionId] = useState(() => Math.random().toString(36).slice(2));
  const [test, setTest] = useState<TestDef>({
    name: "New Test",
    description: "Describe the user goal",
    baseUrl: "http://localhost:3000",
    steps: [
      { action: "navigate", path: "/" }
    ]
  });

  const [recording, setRecording] = useState(false);
  const [lastEvent, setLastEvent] = useState<string>("");

  // Listen for recorder events from any origin; gate by sessionId
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      const d = ev.data;
      if (!d || d.type !== "wt-recorder" || d.sessionId !== sessionId) return;
      const payload = d.payload as any;
      setLastEvent(JSON.stringify(payload));
      setRecording(true);
      setTest((prev) => {
        const steps = prev.steps.slice();
        if (payload.kind === "click") {
          steps.push({ action: "click", selector: payload.selector } as ClickStep);
        } else if (payload.kind === "type") {
          // If last step was a type for the same selector, merge text
          const last = steps[steps.length - 1] as any;
          if (last && last.action === "type" && last.selector === payload.selector) {
            last.text = payload.text;
          } else {
            steps.push({ action: "type", selector: payload.selector, text: payload.text } as TypeStep);
          }
        } else if (payload.kind === "key" && payload.key === "Enter") {
          // Attach pressEnter to the last type step if present
          const last = steps[steps.length - 1] as any;
          if (last && last.action === "type") last.pressEnter = true;
        } else if (payload.kind === "stopped") {
          // no-op; UI handles
        }
        return { ...prev, steps };
      });
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [sessionId]);

  const bookmarkletHref = useMemo(() => makeBookmarklet(sessionId), [sessionId]);
  const yaml = useMemo(() => toYaml(test), [test]);

  function addStep(s: Step) { setTest(t => ({ ...t, steps: [...t.steps, s] })); }
  function removeStep(i: number) { setTest(t => ({ ...t, steps: t.steps.filter((_, idx) => idx !== i) })); }
  function moveStep(i: number, dir: -1 | 1) {
    setTest(t => {
      const steps = t.steps.slice();
      const j = i + dir;
      if (j < 0 || j >= steps.length) return t;
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...t, steps };
    });
  }

  function downloadYaml() {
    const blob = new Blob([yaml], { type: "text/yaml;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${slug(test.name)}.yml`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function slug(s: string) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
        <header className="lg:col-span-2 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Web Test Builder</h1>
          <div className="flex gap-2">
            <button onClick={downloadYaml} className="px-3 py-2 rounded-xl bg-black text-white shadow">Download YAML</button>
            <button onClick={() => navigator.clipboard.writeText(yaml)} className="px-3 py-2 rounded-xl bg-white border shadow">Copy YAML</button>
          </div>
        </header>

        {/* Left: Test meta + steps */}
        <section className="bg-white rounded-2xl shadow p-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm">Test Name</label>
              <input className="mt-1 w-full rounded-xl border px-3 py-2" value={test.name} onChange={e => setTest({ ...test, name: e.target.value })} />
            </div>
            <div>
              <label className="text-sm">Base URL</label>
              <input className="mt-1 w-full rounded-xl border px-3 py-2" value={test.baseUrl ?? ""} onChange={e => setTest({ ...test, baseUrl: e.target.value })} />
            </div>
            <div className="col-span-2">
              <label className="text-sm">Description</label>
              <input className="mt-1 w-full rounded-xl border px-3 py-2" value={test.description ?? ""} onChange={e => setTest({ ...test, description: e.target.value })} />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Steps</h2>
            <div className="flex gap-2 text-sm">
              <button className="px-2 py-1 rounded-lg border" onClick={() => addStep({ action: "waitForSelector", selector: "[data-testid=\"...\"]", timeoutMs: 10000 })}>+ waitForSelector</button>
              <button className="px-2 py-1 rounded-lg border" onClick={() => addStep({ action: "expectVisible", selector: "text=/success/i", timeoutMs: 8000 })}>+ expectVisible</button>
              <button className="px-2 py-1 rounded-lg border" onClick={() => addStep({ action: "screenshot", name: "after" })}>+ screenshot</button>
            </div>
          </div>

          <ul className="divide-y">
            {test.steps.map((s, i) => (
              <li key={i} className="py-3 flex items-start gap-3">
                <span className="mt-1 text-xs text-gray-500 w-6">{i + 1}.</span>
                <div className="flex-1">
                  <div className="text-sm font-mono bg-gray-50 rounded-lg p-2 overflow-auto">
                    {JSON.stringify(s)}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button className="px-2 py-1 rounded-lg border" onClick={() => moveStep(i, -1)}>↑</button>
                    <button className="px-2 py-1 rounded-lg border" onClick={() => moveStep(i, +1)}>↓</button>
                    <button className="px-2 py-1 rounded-lg border text-red-600" onClick={() => removeStep(i)}>Delete</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Right: Recorder & YAML preview */}
        <section className="bg-white rounded-2xl shadow p-4 space-y-4">
          <h2 className="text-lg font-medium">Recorder</h2>
          <p className="text-sm text-gray-600">Cross‑origin pages cannot be recorded inside an iframe. Use the bookmarklet below on the target page; captured clicks/typing will stream back here.</p>

          <div className="flex items-center gap-2">
            <label className="text-sm">Session ID</label>
            <input className="mt-1 w-48 rounded-xl border px-3 py-2" value={sessionId} onChange={e => setSessionId(e.target.value)} />
            <a className="px-3 py-2 rounded-xl bg-emerald-600 text-white shadow" href={bookmarkletHref} title="Drag this to your bookmarks bar; click it on the target site to start recording." onClick={(e) => e.preventDefault()} draggable>
              Drag me to bookmarks → Web Test Recorder
            </a>
          </div>
          <div className="text-xs text-gray-500">Last event: {lastEvent || "(none)"}</div>

          <div>
            <h3 className="text-sm font-medium mb-1">YAML Preview</h3>
            <textarea className="w-full h-64 font-mono text-sm rounded-xl border p-2" value={yaml} onChange={() => {}} />
          </div>
        </section>
      </div>
    </div>
  );
}
