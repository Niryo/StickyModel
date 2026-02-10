# Sticky Model

A zero-UI Chrome extension that persists your Gemini model choice across new chats.

When you select a model (e.g. "Pro") on [gemini.google.com](https://gemini.google.com), Gemini resets it back to the default every time you start a new chat. This extension remembers your last explicit choice and automatically restores it.

No popup, no options page, no menu. It just works.

## Install (local / developer mode)

1. Clone or download this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the repository folder.
5. Navigate to [gemini.google.com](https://gemini.google.com) — the extension is now active.

## How it works

- A content script (`content.js`) runs on `gemini.google.com`.
- It detects the model selector chip and watches for changes.
- When you explicitly pick a model, it saves your choice to `chrome.storage.local`.
- On page load or SPA navigation (new chat), it checks the selector and restores your saved preference if the model has been reset.
- A `MutationObserver` and `pushState`/`replaceState` patches detect SPA navigations without full page reloads.

## Development

### Prerequisites

- Node.js 18+
- Yarn (the repo uses Yarn 4 via Corepack)

### Install dependencies

```bash
corepack enable
yarn install
```

### Run E2E tests

```bash
yarn test:e2e
```

On the first run, a Chrome window will open. Log in to your Google account when prompted. The session is saved in `tests/.chrome-profile/` so you only need to authenticate once.

### Run all tests

```bash
yarn test
```

## Project structure

```
manifest.json      Chrome extension manifest (Manifest V3)
content.js         Content script — model detection, storage, and restoration
background.js      Minimal service worker — exposes chrome.storage for tests
package.json       Dev dependencies (Vitest, Playwright)
tests/
  e2e/
    extension.test.js   E2E tests against real gemini.google.com
  helpers/
    setup.js            Playwright browser launch + auth-wait helper
```

## License

MIT
