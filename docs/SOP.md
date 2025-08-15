# SOP — Web Function Test Agent (Playwright + YAML)

**Version:** 1.0
**Owner:** QA/Eng (Matthew)
**Last Updated:** 2025‑08‑15

---

## 1) Purpose
Provide a repeatable, auditable process to:
- Execute real‑user browser flows against a web app
- Capture signals (console/page errors, HTTP 4xx/5xx, failed requests, screenshots)
- Produce a **builder‑agent prompt** for rapid fixes
- Gate changes in CI with clear pass/fail criteria

## 2) Scope
Applies to all feature flows in the app (e.g., login, upload resume, parse, profile edit). Excludes security/pen‑testing and load tests (covered by separate SOPs).

## 3) Definitions
- **Runner:** `src/runner.ts` — Playwright driver that executes steps from YAML
- **Test plan:** YAML file under `tests/` describing steps & expectations
- **Tolerate:** Per‑test filter of *expected* errors (e.g., 401 in a “bad login” test)
- **Builder prompt:** `builder-prompt.md` — ready‑to‑paste report for the VSCode builder agent

## 4) Roles & Responsibilities
- **Owner:** Maintains runner, schema, CI, and this SOP
- **Test Author(s):** Write/maintain YAML tests; add stable selectors
- **Reviewer:** Ensures tolerate usage is minimal & justified
- **CI Maintainer:** Keeps GitHub Actions healthy and artifacts uploaded

## 5) Prerequisites
- Node.js 18+
- npm, git
- Browsers installed by Playwright (`npx playwright install`)
- Local app URL (e.g., `http://localhost:3000`) or deployed preview URL

## 6) Project Setup
```bash
mkdir web-test-agent && cd web-test-agent
npm init -y
npm i -D typescript ts-node @types/node playwright yaml zod yargs @types/yargs
npx playwright install
# add files from Starter Kit (runner, schema, example test, tsconfig)
```
> Windows PowerShell: use backticks (\`) for multi‑line commands. Bash/Zsh: use backslashes (\).

## 7) Directory & Naming
```
web-test-agent/
  src/
    runner.ts
    schema.ts
  tests/
    <feature>-<flow>.yml   # e.g., login-wrong-password.yml
  reports/                 # auto-created per run
```
- Test file name: `<area>-<scenario>.yml`
- Test `name:`: clear, human-readable (appears in reports)

## 8) Writing a Test (YAML)
### 8.1 Selectors
- Prefer stable attributes: `data-testid="..."`
- Avoid fragile chains like `.container > div:nth-child(3)`

### 8.2 Allowed Steps (schema)
- `navigate`, `click`, `type`, `fill`, `waitForSelector`, `expectVisible`, `expectText`, `wait`, `screenshot`

### 8.3 Tolerate (expected errors)
Use **only** to filter errors that are **expected** for the scenario. All raw signals are still recorded.

```yaml
name: "Login – wrong password shows error"
description: "Bad password should show an error without logging in."
baseUrl: "http://localhost:3000"

tolerate:
  httpErrors: true
  httpStatusAllowlist: [400, 401]
  httpUrlAllowlist:
    - /auth/v1/
    - /api/login
  consoleErrors: true
  consolePatternAllowlist:
    - /401/i
    - "Invalid login"
    - "incorrect password"

steps:
  - action: navigate
    path: "/login"
  - action: waitForSelector
    selector: 'input[name="email"]'
  - action: type
    selector: 'input[name="email"]'
    text: "user@example.com"
  - action: type
    selector: 'input[name="password"]'
    text: "wrong-password"
    pressEnter: true
  - action: expectVisible
    selector: 'text=/invalid|incorrect|error/i'
    timeoutMs: 8000
  - action: screenshot
    name: "after-submit"
```

## 9) Running Tests Locally
### 9.1 Single test
**PowerShell (single line):**
```powershell
npx ts-node src/runner.ts --test tests/login-wrong-password.yml --baseUrl http://localhost:3000 --outDir reports --headless true
```
**Bash/Zsh (multi-line):**
```bash
npx ts-node src/runner.ts \
  --test tests/login-wrong-password.yml \
  --baseUrl http://localhost:3000 \
  --outDir reports \
  --headless true
```

### 9.2 Headed & slow‑mo while crafting
```powershell
npx ts-node src/runner.ts --test tests/<file>.yml --baseUrl http://localhost:3000 --outDir reports --headless false --slowMo 250
```

## 10) Outputs & Where to Find Them
- `reports/<test>-<timestamp>/result.json` — full raw & effective counts
- `reports/<test>-<timestamp>/builder-prompt.md` — paste into VSCode builder agent
- `reports/<test>-<timestamp>/*.png` — screenshots (failures & explicit captures)
- `reports/<test>-<timestamp>/tldr.txt` — one‑line summary

Open latest in VS Code:
```powershell
$latest = Get-ChildItem reports -Directory | Sort-Object LastWriteTime -Descending | Select-Object -First 1
code "$($latest.FullName)uilder-prompt.md"
```

## 11) Pass/Fail Criteria
- **Pass:** `effectiveCounts` step/page/console/http/requestFailures are all zero
- **Fail:** any `effectiveCounts` non‑zero, or any step error
- CI exit code reflects pass/fail (`process.exit(0|1)` in runner)

## 12) Triage Procedure (on Fail)
1. Open `builder-prompt.md` (includes raw vs effective counts, tolerate config)
2. Review **step failures** first (repro details + screenshot)
3. Review **HTTP** and **console** errors; confirm if they should be tolerated for this scenario
4. If it’s a legit defect: create a bug with the template in §15.2
5. Send `builder-prompt.md` to the VSCode builder agent; request patch
6. Validate locally; re-run test; commit with clear message

## 13) CI Integration (GitHub Actions)
```yaml
name: web-test-agent
on:
  pull_request:
  push:

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npx playwright install --with-deps
      - run: npx ts-node src/runner.ts --test tests/login-wrong-password.yml --baseUrl ${{ secrets.APP_URL || 'http://localhost:3000' }} --outDir reports
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: web-test-agent-reports
          path: reports
```
> Add additional tests as separate steps or a matrix.

## 14) Maintenance Rules
- Add/adjust `data-testid` attributes rather than brittle CSS selectors
- Keep `tolerate` minimal; explain additions in PR description
- When UI changes, update tests and screenshots in the same PR
- Remove tolerate entries once the underlying issue is fixed

## 15) Templates
### 15.1 New Test Template
```yaml
name: "<Area> – <Scenario>"
description: "<What the user is trying to accomplish>"
baseUrl: "http://localhost:3000"

tolerate:
  # enable only if needed for this scenario
  # httpErrors: true
  # httpStatusAllowlist: []
  # httpUrlAllowlist: []
  # consoleErrors: true
  # consolePatternAllowlist: []

steps:
  - action: navigate
    path: "/<route>"
  - action: waitForSelector
    selector: '[data-testid="<element>"]'
  - action: click
    selector: '[data-testid="<button>"]'
  - action: expectVisible
    selector: 'text=/success|created|updated/i'
  - action: screenshot
    name: "<moment>"
```

### 15.2 Bug Report Template (paste into tracker)
```
Title: <Area> – <Scenario> fails (effectiveCounts > 0)
Environment: <local|staging|prod>, URL: <url>
Test: <tests/<file>.yml>
When: <timestamp>

Summary:
- Step failures: <n>
- Effective counts: page=<n>, console=<n>, http=<n>, reqFail=<n>

Reproduction:
<Copy "Reproduction Steps & Failures" from builder-prompt.md>

Evidence:
- Screenshots: <folder path>
- Raw signals: result.json (HTTP/console/page)

Expected:
<User visible success criteria>
Actual:
<What happened>
```

### 15.3 VSCode Builder Prompt (how to use)
- Open latest `builder-prompt.md`
- Paste into the builder agent
- Ask: “Propose a minimal patch to fix the failures. Return a diff.”
- Apply patch → re-run → commit

## 16) Troubleshooting
- **YAML parse errors:** remove Markdown fences (```) and fix quotes with single quotes around CSS selectors
- **PowerShell line breaks:** use backticks (\`), not backslashes
- **Yargs typing:** `npm i -D @types/yargs`, import `yargs/yargs`; add `src/types/yargs-helpers.d.ts` if needed
- **Playwright not installed:** run `npx playwright install`
- **Blanket ignore:** avoid CLI `--ignore*` flags in CI; use per‑test `tolerate` only

## 17) Quality Gates
- PR must show test passing in CI (effectiveCounts all zero)
- Any new tolerate entries must be justified in PR and linked to an issue
- Tests must be deterministic (no arbitrary waits unless justified)

## 18) Change Control
- Minor SOP edits by Owner
- Major process or schema changes require PR review by at least one Reviewer

---

**End of SOP**
