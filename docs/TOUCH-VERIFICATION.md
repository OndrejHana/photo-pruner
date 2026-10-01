# Touch verification — 1 October 2026

The touch workspace supports quick culling without zoom. Swipe right keeps and advances; left rejects and advances; up/down browse next/previous without changing decisions. Buttons and hardware keys share the same command path, sequential advancement, and Undo behavior. The existing keyboard mapping remains Y/N, left/up previous, right/down next, 0–5 stars, and U Undo.

## Implementation and scope

React Native Gesture Handler and Reanimated handle direction locking, movement, release feedback, and spring return on the UI thread. Release rules and stale-interaction checks are tested independently. Native React Native form sheets hold Photos, Folder, Details, and Help. Export replaces the workspace while the native Files picker owns presentation. No additional Swift bridge was needed.

Visible controls cover every review action. Photos supports direct selection with decision/rating summaries; Details shows paired filenames and can clear a decision without clearing stars. Save/retry status and unavailable-preview recovery remain visible. Stars alone never imply Keep. Export copies only explicitly kept RAW files; ratings stay in the app and originals remain read-only.

Thumbnail browsing, filters, comparison, and batch actions remain later work. There is no zoom UI or recognizer.

## Build, checks, and review

- `npm run check`: ESLint, TypeScript, and all 35 domain tests passed. New coverage includes gesture intent/thresholds, boundaries, stale or duplicate releases, interaction invalidation, clear-decision Undo, and exact keyboard mappings.
- `npx expo-doctor`: 21/21 checks passed. Production iOS JavaScript export also succeeded.
- [EAS development simulator build](https://expo.dev/accounts/ondrejhana/projects/photo-pruner/builds/afb67bef-1192-4a50-b7b3-6733f8051be0) finished with the new native gesture/animation dependencies. Subsequent JavaScript fixes used Metro Fast Refresh.
- `agent --trust -p "..."` reviews found input-feedback, accessibility, and verification-script issues. Relevant findings were addressed; the final review rated readiness 5/5 with no actionable findings remaining. Reviews after the device runs also corrected the VoiceOver hint to point to buttons, singular/plural labels, and development-client recognition of a restored workspace. The footage precedes these copy/helper-only fixes.

## Observed on iPadOS 26.0 in Appetize

Device: `ipadpro129inch5thgeneration`; native build: `b_qvj24gcu7p27wykfltbyywreci`; visible JavaScript revision: `keeper-touch-v1`. This is a cloud simulator, not the user's physical iPad. Evidence paths below are local, ignored by git.

| User flow | Observation / evidence |
| --- | --- |
| Enter a shoot | Welcome screen and sample-folder loading observed in each session. `evidence/touch-welcome.png`. Opening another source through Files was not repeated in this pass. |
| Keep/reject by swiping | Right keeps and left rejects, each advancing once; Undo restores the changed photo. Part of 12 passing checkpoints in `evidence/touch-swipe/assertions.json`. |
| Browse without deciding | Up advances, down goes back; decisions and totals remain unchanged. Short drag does nothing. First/last navigation stays within bounds. Same swipe assertions and recording. |
| Decide at the last photo | Keep remains on the last photo. Repeating Keep then Undo restores the original decision rather than consuming a redundant Undo entry. Same swipe assertions. |
| Rate, correct, and revisit | 14 passing control checkpoints: five stars, clear stars, Undo, Keep/Reject, Previous/Next, direct Photos selection, paired RAW/JPEG details, clear decision, and Undo clear. `evidence/touch-controls/assertions.json`. |
| Use keyboard consistently | Seven passing checkpoints deliver native 5/Y/N/U and left/right events, then assert resulting review state. All requested key mappings also have domain coverage. `evidence/touch-keyboard/assertions.json`. |
| Resume saved work | Five passing checkpoints: rescan retains selected position/totals and restores Keep with five stars plus Reject. `evidence/touch-persistence-final/assertions.json`. This verifies rescan persistence, not cold process relaunch. |
| Export selected RAWs | Confirmation names one RAW copy, two skipped unreviewed items, and in-app-only stars. Two assertions passed; native destination picker captured and manually inspected. `evidence/touch-export-final/assertions.json`. |
| Finish export | Choosing Keeper's Documents directory produced “Copied 1 RAW file” and “All copies verified.” `evidence/touch-export-result.json`, `.png`, and `.mp4`. |
| Preserve source and cancel destination | Reopening Files showed a new Keepers folder with one item beside the six-item sample source. `evidence/touch-cancel-picker.png`. Cancelling returned to enabled review controls with the same Keep/five stars and no export-result banner: `evidence/touch-export-cancelled.json`, `.png`. |
| Rotate and handle unavailable previews | Portrait controls remain visible and the preview measures 976×732 points (4:3). `evidence/touch-portrait.png`, `.json`. Landscape preview was 765×573 points, allowing rounding. The invalid standalone sample NEF displays unavailable-preview guidance and still accepts an explicit Keep in the last-photo swipe check. |

Four named sessions (`keeper-touch-1` through `keeper-touch-4`) were stopped. Metro and its tunnel were stopped after verification. Session two expired during the first persistence attempt; the complete rerun above passed. The initial export check read a scoped container without its separately exposed iOS text; the script now waits for the container then reads the full hierarchy, and the rerun passed. These incomplete attempts remain in ignored evidence and are not counted as successful runs.

## Repeatable verification and video

`scripts/verify-touch.mjs` uses an existing connected session, inspects before acting, waits for review controls to become enabled, and captures hierarchy/screenshots after assertions. It records action timestamps alongside optional video. See [DEVELOPMENT.md](DEVELOPMENT.md) for credentials, native builds, and Metro setup.

```sh
node scripts/verify-touch.mjs --help
node scripts/verify-touch.mjs --phase swipe --record --session-id SESSION
node scripts/verify-touch.mjs --phase controls --record --session-id SESSION
node scripts/verify-touch.mjs --phase keyboard --record --session-id SESSION --session-file artifacts/appetize-session.json
node scripts/verify-touch.mjs --phase persistence --record --session-id SESSION
node scripts/verify-touch.mjs --phase export --record --open-picker --session-id SESSION
```

Start swipe, controls, and keyboard with the fresh unreviewed sample; they restore that state. Persistence leaves one Keep with five stars and one Reject for export. Export's picker capture requires manual inspection and interaction to establish completion. Split phases into short sessions where the account's active-session limit requires it. Never print credentials or session files. Stop recordings and sessions even after failed assertions.

The captioned walkthrough is delivered separately as `evidence/keeper-touch-demo.mp4` (119.9 seconds, 4.12 MB). Full video decoding passed, and captions/contact sheets were inspected. Source phase recordings and its editing timeline remain under ignored `evidence/`. Recordings, screenshots, build archives, and signed metadata are not committed. The PR links this verification record; the task handoff provides the video.

## Limits

- A normal CLI swipe is single-pointer: actual multi-touch cancellation, interrupted touches, physical-device frame rate, audible VoiceOver announcement order, and competition with iPadOS gestures near screen edges were not manually established. Release guards and reduced-motion behavior are implemented; the guard logic has automated coverage.
- The sample NEFs are synthetic and intentionally unreadable. This pass verifies UI, pairing, persistence, and native copy/export; it does not establish real camera RAW decoding. Prior macOS ORF evidence remains separately documented in [VERIFICATION.md](VERIFICATION.md).
- Cold relaunch, revoked permissions, low disk, termination during export, external drives, and large-library performance were not manually repeated. No device performance claim is inferred from the domain burst tests.
