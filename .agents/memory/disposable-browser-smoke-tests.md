---
name: Disposable browser smoke tests
description: Isolation guidance for manual UI checks when browser-test packages are unavailable.
---

The workspace may have a Chromium binary even when Playwright and Puppeteer packages are absent. A fresh temporary Chromium user-data directory isolates IndexedDB from the user's browser data; Node's built-in WebSocket can drive Chrome DevTools Protocol without installing a package.

**Why:** Manual smoke checks must not read, overwrite, or clear the student's normal browser storage.

**How to apply:** Only for an explicitly requested browser check, use a unique temporary profile and synthetic data. Do not attach to the existing preview browser profile. Wait until Chromium has fully exited before deleting the temporary profile, since shutdown can race directory cleanup.