# Web Function Test Agent (Playwright + YAML)

Test real user flows in a browser, capture errors/screenshots, and auto‑generate a prompt for your VS Code builder agent.

- **Runner:** `src/runner.ts` (Playwright + ts-node)
- **Tests:** YAML under `tests/`
- **Reports:** JSON + screenshots + `builder-prompt.md` under `reports/`

> Full operating procedure: see [`docs/SOP.md`](docs/SOP.md)

## Quickstart
```bash
npm i -D typescript ts-node @types/node playwright yaml zod yargs @types/yargs
npx playwright install
```

**Run a test (Windows PowerShell, single line):**
```powershell
npx ts-node src/runner.ts --test tests/login-wrong-password.yml --baseUrl http://localhost:3000 --outDir reports --headless true
```

**Run a test (bash/zsh):**
```bash
npx ts-node src/runner.ts \
  --test tests/login-wrong-password.yml \
  --baseUrl http://localhost:3000 \
  --outDir reports \
  --headless true
```

## Outputs
- `reports/<test>-<timestamp>/result.json` – raw & effective counts
- `reports/<test>-<timestamp>/builder-prompt.md` – paste into your builder agent
- `reports/<test>-<timestamp>/*.png` – screenshots

## Writing a test
Prefer stable `data-testid` selectors. Example:

```yaml
name: "Login – wrong password shows error"
baseUrl: "http://localhost:3000"

tolerate:
  httpErrors: true
  httpStatusAllowlist: [400, 401]
  httpUrlAllowlist: ["/auth/v1/", "/api/login"]
  consoleErrors: true
  consolePatternAllowlist: ["/401/i", "Invalid login", "incorrect password"]

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

## NPM scripts (optional)
Add to `package.json`:

```json
{
  "scripts": {
    "test:login": "ts-node src/runner.ts --test tests/login-wrong-password.yml --baseUrl http://localhost:3000 --outDir reports",
    "test:headed": "ts-node src/runner.ts --test tests/login-wrong-password.yml --baseUrl http://localhost:3000 --outDir reports --headless false --slowMo 250"
  }
}
```

## CI
See [`docs/SOP.md#13-ci-integration`](docs/SOP.md#13-ci-integration) for a ready‑to‑use GitHub Actions workflow.
