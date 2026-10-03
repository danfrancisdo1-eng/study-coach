---
name: Expo dependency coordination
description: Replit package age and cross-artifact React typing lessons for the Study Coach Expo workspace.
---

New Expo patch releases can be rejected by the workspace's minimum release age even when a newer Expo core package requires those exact patches. Exclude only the necessary package names from that gate, rather than disabling the gate globally or downgrading the declared Expo version.

**Why:** A fresh dependency resolution repeatedly rejected newly published Expo patches required transitively by Expo core and Expo Router; targeted exclusions allowed the lockfile to resolve without relaxing unrelated packages.

**How to apply:** Before changing Expo dependencies, check release timing and transitive version constraints. Prefer mature compatible versions where Expo permits them, and keep any age-gate exceptions narrowly scoped.

Keep one React type version across web, slides, and native workspace dependencies when resolving the lockfile.

**Why:** Mixing React type releases produced incompatible JSX component and ref types in unrelated artifacts even though each package's individual version range appeared valid. A single compatible version resolved all workspace typechecks.

**How to apply:** After dependency changes, run the workspace-wide typecheck, not just the mobile artifact's check; align React type versions globally before editing unrelated UI components to silence type errors.