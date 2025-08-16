import { useEffect, useMemo, useState } from "react";
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

// (Helper functions previously used in TS removed; the bookmarklet defines its own equivalents.)

// --- Bookmarklet source ---
function makeBookmarklet(sessionId: string) {
  const code = `(() => {\n  const sid = ${JSON.stringify(sessionId)};\n  if (!sid) { alert('No session id'); return; }\n  const cfg = { maxText: 40 };\n  const cssEscape = (s) => s.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\"');\n  const shortCssPath = (e) => {\n    const parts = []; let cur = e; let depth = 0;\n    while (cur && cur.nodeType === 1 && depth < 4) {\n      const id = cur.id;\n      if (id) { parts.unshift('#' + cssEscape(id)); break; }\n      const tag = cur.tagName.toLowerCase();\n      const p = cur.parentElement;\n      if (!p) { parts.unshift(tag); break; }\n      const idx = Array.from(p.children).indexOf(cur)+1;\n      parts.unshift(tag + ':nth-child(' + idx + ')');\n      cur = p; depth++;\n    }\n    return parts.join(' > ');\n  };\n  const bestSelector = (el) => {\n    if (!el) return 'body';\n    const dt = el.getAttribute && el.getAttribute('data-testid');\n    if (dt) return '[data-testid="' + cssEscape(dt) + '"]';\n    if (el.id) return '#' + cssEscape(el.id);\n    if (el.tagName && el.tagName.toLowerCase() === 'input' && el.name) return 'input[name="' + cssEscape(el.name) + '"]';\n    const tag = el.tagName ? el.tagName.toLowerCase() : '';\n    if (tag === 'button' || tag === 'a') {\n      const txt = (el.textContent || '').trim();\n      if (txt && txt.length <= cfg.maxText) {\n        const safe = txt.replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&');\n        return 'text=/' + safe + '/i';\n      }\n    }\n    return shortCssPath(el);\n  };\n  const post = (payload) => {\n    window.postMessage({ type: 'wt-recorder', sessionId: sid, payload }, '*');\n  };\n  const onClick = (e) => {\n    const sel = bestSelector(e.target);\n    post({ kind: 'click', selector: sel });\n  };\n  const onInput = (e) => {\n    const t = e.target; if (!t || !t.tagName) return;\n    const tag = t.tagName.toLowerCase();\n    if (tag !== 'input' && tag !== 'textarea') return;\n    const sel = bestSelector(t);\n    const val = t.type === 'password' ? '***' : String(t.value || '');\n    post({ kind: 'type', selector: sel, text: val });\n  };\n  const onKeydown = (e) => { if (e.key === 'Enter') post({ kind: 'key', key: 'Enter' }); if (e.key === 'Escape') cleanup(); };\n  function cleanup(){\n    document.removeEventListener('click', onClick, true);\n    document.removeEventListener('input', onInput, true);\n    window.removeEventListener('keydown', onKeydown, true);\n    overlay && overlay.remove();\n    post({ kind: 'stopped' });\n  }\n  // Small overlay\n  const overlay = document.createElement('div');\n  overlay.style.cssText = 'position:fixed;bottom:12px;right:12px;background:#111;color:#fff;padding:8px 10px;border-radius:10px;font:12px system-ui;z-index:999999;opacity:.9;';\n  overlay.textContent = 'Recording… click/type to capture (ESC to stop)';\n  document.body.appendChild(overlay);\n  document.addEventListener('click', onClick, true);\n  document.addEventListener('input', onInput, true);\n  window.addEventListener('keydown', onKeydown, true);\n})();`;
  return `javascript:${encodeURIComponent(code)}`;
}

// --- YAML generation ---
function toYaml(test: TestDef) {
  // Ensure all selectors with quotes are valid in YAML by using single-quoted strings when needed
  return YAML.stringify({
    name: test.name,
    description: test.description,
    baseUrl: test.baseUrl,
    ...(test.tolerate ? { tolerate: test.tolerate } : {}),
    steps: test.steps
  });
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

  // recording flag not needed; we show last event only
  const [lastEvent, setLastEvent] = useState<string>("");

  // Listen for recorder events from any origin; gate by sessionId
  useEffect(() => {
    type RecorderClick = { kind: 'click'; selector: string };
    type RecorderType = { kind: 'type'; selector: string; text: string };
    type RecorderKey = { kind: 'key'; key: string };
    type RecorderStopped = { kind: 'stopped' };
    type RecorderPayload = RecorderClick | RecorderType | RecorderKey | RecorderStopped;
    function onMsg(ev: MessageEvent) {
      const d = ev.data;
      if (!d || d.type !== "wt-recorder" || d.sessionId !== sessionId) return;
      const payload = d.payload as RecorderPayload;
      setLastEvent(JSON.stringify(payload));
  // mark as active implicitly by showing last event
      setTest((prev) => {
        const steps = prev.steps.slice();
        if (payload.kind === "click") {
          steps.push({ action: "click", selector: payload.selector } as ClickStep);
        } else if (payload.kind === "type") {
          // If last step was a type for the same selector, merge text
          const last = steps[steps.length - 1];
          if (last && last.action === "type" && (last as TypeStep).selector === payload.selector) {
            (last as TypeStep).text = payload.text;
          } else {
            steps.push({ action: "type", selector: payload.selector, text: payload.text } as TypeStep);
          }
        } else if (payload.kind === "key" && payload.key === "Enter") {
          // Attach pressEnter to the last type step if present
          const last = steps[steps.length - 1];
          if (last && last.action === "type") (last as TypeStep).pressEnter = true;
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
    <div className="min-h-screen bg-gradient-to-br from-emerald-500 to-blue-500 text-gray-900 p-2 flex items-center justify-center">
      <div className="max-w-[1200px] mx-auto rounded-3xl bg-white shadow-xl overflow-hidden" style={{ border: '4px solid #dc2626' }}>
        <header className="px-6 py-4 flex items-center justify-between" style={{ backgroundColor: '#dc2626' }}>
          <h1 className="text-2xl font-semibold" style={{ color: 'white' }}>Web Test Builder</h1>
          <div className="flex gap-2">
              <button onClick={downloadYaml} className="px-3 py-2 rounded-xl bg-white text-red-700 border border-white/50 shadow transition hover:bg-white/90">Download YAML</button>
              <button onClick={() => navigator.clipboard.writeText(yaml)} className="px-3 py-2 rounded-xl bg-white text-red-700 border border-white/50 shadow transition hover:bg-white/90">Copy YAML</button>
          </div>
        </header>

  <div className="p-6">
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

  {/* Left: Test meta + steps */}
  <section className="bg-red-50 rounded-2xl p-6 space-y-6 shadow-sm border-2 border-red-300">
          <div className="grid grid-cols-2 gap-4 p-4">
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
        <button className="px-2 py-1 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => addStep({ action: "waitForSelector", selector: "[data-testid=\"...\"]", timeoutMs: 10000 })}>+ waitForSelector</button>
        <button className="px-2 py-1 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => addStep({ action: "expectVisible", selector: "text=/success/i", timeoutMs: 8000 })}>+ expectVisible</button>
        <button className="px-2 py-1 rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50" onClick={() => addStep({ action: "screenshot", name: "after" })}>+ screenshot</button>
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
  <section className="bg-red-50 rounded-2xl p-6 space-y-6 shadow-sm border-2 border-red-300">
          <h2 className="text-lg font-medium">Recorder</h2>
          <p className="text-sm text-gray-600">Cross‑origin pages cannot be recorded inside an iframe. Use the bookmarklet below on the target page; captured clicks/typing will stream back here.</p>

          <div className="flex items-center gap-3 mt-2">
            <label className="text-sm">Session ID</label>
            <input className="mt-1 w-56 rounded-xl border px-3 py-2" value={sessionId} onChange={e => setSessionId(e.target.value)} />
            <a className="px-3 py-2 rounded-xl bg-emerald-600 text-white shadow" href={bookmarkletHref} title="Drag this to your bookmarks bar; click it on the target site to start recording." onClick={(e) => e.preventDefault()} draggable>
              Drag me to bookmarks → Web Test Recorder
            </a>
          </div>
          <div className="text-xs text-gray-500">Last event: {lastEvent || "(none)"}</div>

          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <h3 className="text-sm font-medium mb-2">YAML Preview</h3>
            <textarea className="w-full h-64 font-mono text-sm rounded-lg border p-3 bg-gray-50" value={yaml} onChange={() => {}} />
          </div>
  </section>

  </div>
  </div>
      </div>
    </div>
  );
}
