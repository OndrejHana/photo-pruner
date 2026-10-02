# Touch verification — 1 October 2026, v2

For the subsequent preview/animation improvements and their verification, see [Interaction review — v3](INTERACTION-REVIEW.md). This page retains the v2 evidence.

The touch workspace supports quick culling without zoom. Swipe right keeps and advances; left rejects and advances; up/down browse next/previous without changing decisions. Buttons and hardware keys share the same command path, sequential advancement, and Undo behavior. The existing keyboard mapping remains Y/N, left/up previous, right/down next, 0–5 stars, and U Undo.

## Implementation and scope

The v2 workspace restores the persistent photo sidebar at widths of at least 1100 points. It follows the selected photo and stays open after row selection. Narrow layouts use the Photos form sheet; selecting a row returns to review. Sample shoot, Open folder, and Rescan are direct header controls. Paired filenames remain beneath the preview, and the keyboard legend remains in the footer. Help separates swipe directions from keyboard arrows.

Buttons and hardware keys continue to review and rate while previews decode. Horizontal decision swipes wait for the current image to display or an explicit unavailable-preview result; vertical swipes browse without deciding. React Native Gesture Handler and Reanimated handle direction locking, movement, and spring return on the UI thread. A captured interaction key rejects stale releases after navigation, editing, locking, or rescanning; image callbacks also carry a per-visit identity. There is no zoom UI or recognizer.

Clear decision stays on the photo and preserves stars; Undo restores the change. Export confirmation and progress appear above the existing workspace, retaining its photo and list while locking review, selection, folder actions, and keyboard input. Native Files owns the destination picker. Export still copies only explicitly kept RAW files; stars remain in the app and originals remain read-only. No Swift copy, preview, or serialization algorithm changed.

Save, folder, review-load, and export errors retain their source. Successful saving clears save errors while preserving an unreadable-review warning. Cancelling a folder picker preserves that warning; dismissing a newer folder error reveals it. Retry preview remains available for unreadable images.

Thumbnail browsing, filters, comparison, and batch actions remain later work.

## Build, checks, and review

- `npm run check`: ESLint, TypeScript, 41 domain tests, and nine App/hook tests passed (50 total).
- Domain coverage includes gesture intent/thresholds, boundaries, stale or duplicate releases, interaction invalidation, clear-decision Undo, exact keyboard mappings, and save-error provenance.
- `tests/ui` executes the actual App handlers, workspace hook, review reducer, and coalesced writer. It covers rapid hardware commands, explicit review while decoding, persistent sidebar selection, modal input gates, stale swipe delivery, failed-save recovery, and corruption warnings surviving picker cancellation/error dismissal. It replaces native APIs, layout, image events, the gesture surface, and Modal with test bindings. It does not exercise native touch recognition, UIKit dismissal/focus timing, image rendering, or audible VoiceOver output.
- `npx expo-doctor`: 21/21 checks passed. The v2 production iOS JavaScript export succeeded: 1060 modules and a 2.7 MB Hermes bundle.
- [EAS development simulator build](https://expo.dev/accounts/ondrejhana/projects/photo-pruner/builds/afb67bef-1192-4a50-b7b3-6733f8051be0) finished with the new native gesture/animation dependencies. Subsequent JavaScript fixes used Metro Fast Refresh.
- The first v2 review found warning preservation and missing App-level coverage; the hook and App tests were updated. The second review rated code readiness 5/5 with no relevant issues remaining. Its shell was unavailable, so the local checks above are the independent execution evidence.

## Observed on iPadOS 26.0 in Appetize

Device: `ipadpro129inch5thgeneration`; native build: `b_qvj24gcu7p27wykfltbyywreci`; visible JavaScript revision: `keeper-touch-v2`. The v2 JavaScript runs in the same compatible native build. This is a cloud simulator, not the user's physical iPad. Evidence paths below are local, ignored by git.

| User flow | Observation / evidence |
| --- | --- |
| Open a source folder | Sample shoot loads directly. Open folder navigated through On My iPad → Keeper → Sample shoot v2 and loaded the four review items from its six files. `evidence/touch-v2-source-portrait.mp4` and `touch-v2-source-opened.{json,png}`. |
| Preserve the existing landscape workflow | 13 passing assertions cover persistent sidebar selection, native keyboard review, visible pairing/hints, direct folder controls, and preview size. `evidence/touch-v2-legacy/assertions.json`. The landscape frame measured 902×677 points, allowing rounding, compared with the original recorded 833×624 minimum. |
| Keep/reject, browse, and correct by swipe | 12 passing assertions: right/left decide and advance; up/down browse; short drags and boundary browsing leave state unchanged; Undo restores the changed photo. Repeated Keep at the last photo preserves useful Undo history. `evidence/touch-v2-swipe/assertions.json`. |
| Return from portrait sheets | Portrait Photos selection returned to DSC_0003; Help dismissal restored enabled review and folder controls. `evidence/touch-v2-sheet-return.{json,png}`. This establishes those observed sheet returns, not every dismissal race. |
| Rate, clear, and revisit | 14 passing control assertions cover stars, clear stars, Undo, Keep/Reject, Previous/Next, direct selection, pairing metadata, Clear decision, and Undo clear. `evidence/touch-v2-controls-complete/assertions.json`. |
| Resume saved work | Five passing assertions restore selected position, totals, Keep/five stars, and Reject after direct Rescan. `evidence/touch-v2-persistence/assertions.json`. This checks rescan, not cold process relaunch. |
| Keep context during export | Three passing assertions establish the precondition, inline confirmation, and visible locked workspace; the native destination picker was also captured. `evidence/touch-v2-export/assertions.json`. The photo, sidebar, paired filenames, and keyboard legend remain visible during confirmation and progress. |
| Finish or cancel export | Choosing Keeper's Documents directory reported one verified RAW copy. Reopening Files showed one item in Keepers beside the six-item source. Cancelling a second destination selection restored enabled review, Keep/five stars, and no new result banner. `evidence/touch-v2-export-result.{json,png,mp4}`, `touch-v2-cancel-picker.png`, and `touch-v2-export-cancelled.{json,png}`. |

All five v2 regression sessions, their recordings, Metro, and the tunnel were stopped. The four original touch sessions were also stopped. Regression session two expired near the end of controls; the complete session-three rerun passed and is the control evidence above. The incomplete attempt is not counted as a successful phase. There are 47 passing scripted v2 assertions, plus the manual picker, copy, cancellation, and sheet-return checks.

The earlier `keeper-touch-v1` pass established controls, keyboard, rescan persistence, verified sample RAW export, source preservation, and cancellation; its evidence remains under `evidence/touch-*`. That UI had a smaller 765×573 landscape preview and replaced the workspace during export. Those records and the earlier video do not establish v2 layout or workflow parity.

## Repeatable verification and video

`scripts/verify-touch.mjs` uses an existing connected session, inspects before acting, and captures hierarchy/screenshots after assertions. Buttons/keys wait for interactive controls; scripted swipes additionally wait for a displayed image or explicit preview error. It records action timestamps alongside optional video. See [DEVELOPMENT.md](DEVELOPMENT.md) for credentials, native builds, and Metro setup.

```sh
node scripts/verify-touch.mjs --help
node scripts/verify-touch.mjs --phase legacy --record --session-id SESSION --session-file artifacts/appetize-session.json
node scripts/verify-touch.mjs --phase swipe --record --session-id SESSION
node scripts/verify-touch.mjs --phase controls --record --session-id SESSION
node scripts/verify-touch.mjs --phase keyboard --record --session-id SESSION --session-file artifacts/appetize-session.json
node scripts/verify-touch.mjs --phase persistence --record --session-id SESSION
node scripts/verify-touch.mjs --phase export --record --open-picker --session-id SESSION
```

Start legacy, swipe, controls, and keyboard with the fresh unreviewed four-photo sample; they restore that state. Legacy requires the 1366×1024 landscape session and checks the preview against the original 833×624 minimum. Persistence leaves one Keep with five stars and one Reject for export. Export's picker capture requires manual inspection and interaction to establish completion. Give each phase its own evidence directory; `verify-ui.mjs` places controls and persistence in separate subdirectories when a common evidence directory is supplied. Split phases into short sessions where the account's active-session limit requires it. Never print credentials or session files. Stop recordings and sessions even after failed assertions.

The v2 captioned walkthrough is delivered separately as `evidence/keeper-touch-demo.mp4`; its source recordings and editing timeline remain under ignored `evidence/`. It covers the nominal user flows above. Injected save failures, corrupted reviews, and deliberately delayed previews are automated App/hook checks, not simulated footage. Some clips show the development client's blue Refreshing overlay. Recordings, screenshots, build archives, and signed metadata are not committed.

## Limits

- A normal CLI swipe is single-pointer: actual multi-touch cancellation, interrupted touches, physical-device frame rate, audible VoiceOver announcement order, and competition with iPadOS gestures near screen edges were not manually established. Release guards and reduced-motion behavior are implemented; the guard logic has automated coverage.
- The sample NEFs are synthetic and intentionally unreadable. This pass verifies UI, pairing, persistence, and native copy/export; it does not establish real camera RAW decoding. Prior macOS ORF evidence remains separately documented in [VERIFICATION.md](VERIFICATION.md).
- Cold relaunch, revoked permissions, low disk, termination during export, external drives, and large-library performance were not manually repeated. Automated mocked save failures and corrupt-review tests cover App/hook recovery paths, not native storage failures. No device performance claim is inferred from the domain burst tests or App harness.
