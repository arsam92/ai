# RigLab — Browser Character Studio

A small, real browser-based character-animation project used to validate the HTML JS CSS AI workflow. This repository was empty when inspected, so this is a new runnable baseline rather than a test of a pre-existing website.

## What it contains

- A Three.js procedural articulated character with named joint pivots.
- Editable joint controls, a timeline, keyframes, playback, a walk-cycle preset, JSON export/import, and responsive UI.
- Playwright tests that run Chromium and collect console errors, uncaught page exceptions, failed requests, and HTTP responses >= 400.
- A GitHub Actions workflow that runs the browser test suite on pushes and pull requests, then uploads Playwright reports.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npx playwright install chromium
npm test
npm run dev
```

Open the Vite URL printed by `npm run dev` (normally `http://127.0.0.1:4173`).

## How to read test results

The browser suite fails on unexpected console errors, uncaught page exceptions, failed requests, or HTTP >= 400 responses. CI uploads `playwright-report/` and `test-results/`, including the JSON audit report.

The character is a procedural preview rig, not a custom skinned production mesh. The tests verify the real Chromium/WebGL scene and the implemented editing path; they do not prove perfect animation quality or guarantee that every browser is bug-free.

## Manual browser Console check

Open DevTools → Console, reload the app, use the joint controls, create a walk cycle, play/pause, export/import JSON, and resize to mobile width. CI results are in GitHub Actions → the latest **Browser smoke tests** run.
