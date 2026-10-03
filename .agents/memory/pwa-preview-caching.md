---
name: PWA preview caching
description: A service-worker cache can hide current frontend edits in the development preview.
---

In a PWA, do not let a development preview's service worker cache-first its module requests. Keep the production worker able to update its cached app shell, but prevent old workers from controlling the development preview.

**Why:** A workflow restart and correct network responses still showed an obsolete onboarding screen because a previously installed worker served cached Vite modules. A worker version bump alone did not make the first screenshot current; clearing the development worker before loading the entry module did.

**How to apply:** When a preview shows content that conflicts with the current source, compare the network-served module to the screenshot and check service-worker registration/cache strategy before rewriting components. Keep production offline behavior separate from development.