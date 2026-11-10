# Mobile Plan 3 completion — 2026-11-01

Continued the interrupted fix round from commit 899a618. The original task implementations and reviews remain in the local SDD ledger; this report records the final continuation honestly, without claiming a new Opus review.

## Final fixes

- KYC camera, picker and compression cache files are removed after upload, retake, screen exit and sign-out. Late camera/compression/upload results are discarded after leaving the screen or changing sessions. Gallery originals outside the app cache are preserved; deletion failures never block sign-out.
- Unknown future UPI app names and KYC document kinds are filtered without rejecting the whole response or losing minimum-version settings.
- Unreadable withdrawal responses retain the single-flight hold while reconciliation runs (with a deadline).
- Withdrawal requests optionally carry the client's currency. Web and mobile send it; the repository refuses stale units before limits and again inside the debit transaction. Refusals carry a stable 409 code and refresh the app's wallet.
- Deposit receipts retain the actual ledger currency after conversion, reuse the deposit credit's currency inference, and omit the historical balance after a switch. They never relabel rupees as dollars.
- Frozen/banned bootstrap is blocked even if a bearer token remains valid. The app recognizes the blocked code.
- Currency-switch refusals are translated into English and Hindi; profile save respects centrally handled errors; Aadhaar has a readable masked accessibility label.
- Fixed the deposit automation's amount-sheet race and documented the separate visual capture flow.
- Corrected FAQ answers 3, 4, 6 and 8 in shared website copy and both app languages. Live funds, Demo funds and internal pricing/settlement are disclosed; no claim of exchange execution is made.

## Verification

- Mobile: 1,505 tests passing; TypeScript passing.
- Contracts: 123 tests passing. Client core: 121 tests passing.
- Focused real-database deposit, receipt and withdrawal suites: 100 tests passing.
- Withdrawal and bootstrap route suites: 13 tests passing.
- Website TypeScript passing; Android production bundle export successful.
- ESLint passing for mobile source and affected server/contracts files.
- All database work used the new local `asm_codex_complete_test` database and Redis database 13. No production credentials or data used.

A broad DB run also exposed existing catalogue precision assertions and fixture-dependent tests requiring legacy assets. These are separate from the passing focused suites above.

## Release and review status

The owner chose to migrate mobile trading to CFD on 2026-11-01. That continuation, push notifications (P4), and distribution (P5) are tracked separately and must be integrated and checked before release. This P3 report alone does not authorize or certify a production release.

Money hotfix #127 remains a prerequisite for deployment. Physical-device UPI/camera checks, native Hindi review, owner-owned Firebase/OAuth/signing credentials, and store approval remain external release requirements. Do not publish an unsigned or debug-signed release.
