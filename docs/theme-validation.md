# Theme validation command evidence

Validated the combined branch after `fc322ec` on 2026-11-17. The browser matrix and final production build are tracked separately in `docs/light-theme-report.md`.

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm --filter @asm/web exec tsc --noEmit` | Pass, exit 0 | `/tmp/theme-final-tsc.log` |
| `pnpm --filter @asm/web test` | 652 pass, 1 pre-existing failure; 109 files pass, 1 fails | `/tmp/theme-final-test.log` |
| Root ESLint, JSON formatter | 1,770 errors, no new errors versus the starting commit | `/tmp/theme-final-lint.json`, `/tmp/theme-final-lint-comparison.json` |
| Chart suite | 87 pass across 11 files | `/tmp/chart-tests.log` |
| Theme store/bootstrap/routing tests | 30 pass across 2 files (including the later meta-content observer fix) | `/tmp/theme-routing-final.log` |

The starting commit `2b49299` was checked separately in the clean `light-theme-baseline` worktree. Its web suite has 604 passes and the same failing `GET /api/trades` test: `prisma.asset.findFirstOrThrow()` cannot find the `BTCUSD` asset in the local fixture database (`/tmp/theme-base-tests.log`). The theme changes do not alter that test or its trading logic.

The same starting checkout has 1,771 ESLint errors (`/tmp/theme-base-lint.json`). Comparing normalized relative file paths, rule IDs and messages finds zero added errors. The one removed error is the unused `applySeriesAlpha` helper removed during the chart color sweep. Existing unused imports and empty catch blocks were left unchanged.

All pre-existing dark `@theme` color values in `globals.css` compare exactly equal to `2b49299`. Chart tests compile the real chart token stylesheet through Tailwind/PostCSS and require every dark default and light override to survive CSS optimization. This catches the case where JS-only canvas token names would otherwise lose their dark defaults.

The chart switch test covers all eleven chart types with an open OTC position and SL/TP lines. It checks the same chart instance, series and native price lines, unchanged market subscriptions and viewport writes, the same countdown DOM node, unchanged price data and market snapshot, and one computed-style resolution per switch despite repeated palette reads. These are automated DOM/lifecycle and CSS checks; they do not measure browser frame rate or actual-device smoothness.

Theme robustness tests cover strict bootstrap cookie parsing (including preceding cookies), `/start` legacy/device behavior, global-cookie precedence, throwing and silently blocked cookie writes, client navigation through admin, cross-tab messages while admin remains dark, and a single theme-color meta after hydration or streamed metadata insertion, and correction when React updates an existing meta content attribute. The last observer fix was verified with the targeted theme suites and ESLint; the full-suite count above predates that additional test.
