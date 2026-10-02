# Interaction review — 2 October 2026, v3

This records the response to the [PR #12 interaction-design review](https://github.com/OndrejHana/photo-pruner/pull/12#issuecomment-5947681097). V3 implements selected recommendations while preserving the recently verified review workflow. It does not implement all eight proposed directions.

## Implemented

- **Prepare neighboring previews.** The window is current, next, previous, then second-next. One native decode and one memory warm may run; unsent work follows the latest selection. Eight revision-scoped URI/results are retained, and `expo-image` memory caching is capped at eight images / 96 MiB. Cached selections skip another native preview request. Speculative failures remain cached and become visible only if that item is selected; explicit retry prepares it again.
- **Separate commitment from animation.** Accepted commands commit immediately. A separate outgoing layer ignores touches and exits over 190 ms, fading over 130 ms; reduced motion uses a 90 ms fade. Ready neighboring images can appear underneath. Undo uses the reversed decision's direction. Animation never gates the next input; stale releases and final-item no-ops remain cancellations.
- **Match feedback to release rules.** Edge feedback arms using the same distance/flick classifier as release, and disarms when the drag retreats. Unavailable directions resist movement. These cues replace the central drag label without changing decision thresholds.
- **Make decisions and progress visible.** Kept/rejected photos receive a ring and corner badge, while image colors stay unchanged for inspection. Sidebar rows have decision colors. Aggregate progress and a nonmodal completion summary show the remaining work and keep Export accessible.
- **Reduce control weight without removing access.** Secondary controls are quieter, Export shows the Keep count, tapping the current star rating clears it, and feedback offers Undo for five seconds. Export confirmation still reports the actual RAW files and any kept items without RAWs.

The persistent wide sidebar, direct folder actions, visible pairing, fixed 4:3 preview frame, and one always-visible keyboard legend remain. Buttons and hardware keys can review while decoding; decision swipes require a displayed image or explicit unavailable-preview result. Originals stay read-only, stars stay in the app, and exports remain verified RAW copies.

## Deliberately deferred

Folder-menu consolidation, dropping the frame, and hiding keyboard hints would undo the recent workflow fixes. Rejected-image desaturation would alter the image being judged. Per-photo draggable progress ticks, animated counters, a fullscreen finish screen, drag-to-rate stars, and two-finger Undo add scope or gesture conflicts without being needed for this pass. Haptics and audio are also deferred; the visual cues carry the feedback. The aggregate progress strip and completion summary are the implemented alternatives, not the proposed per-photo strip or finish screen.

## Limits and verification

The native Files worker is serial and its ImageIO decode cannot be cancelled. A cold selection, rescan, or export can wait behind one already-running speculative decode; the scheduler prevents further obsolete requests from accumulating. Revision-scoped URI reuse means source changes become visible on rescan. Export still validates source fingerprints. The configured memory cache is a budget, not a guarantee of residency under OS memory pressure.

- `npm run check`: ESLint, TypeScript, and all 80 tests passed. The production iOS export also passed (1061 modules; 2.7 MB Hermes bundle). No native code or dependency changed; verification reuses the compatible EAS development client.
- Automated coverage includes bounded bursts, current-before-neighbor priority, cached navigation, revision/retry suppression, error recovery, and actual App/hook commands with mocked platform bindings. Those tests do not execute native gestures, UIKit lifecycle, image rendering, or audible VoiceOver output.
- Three independent `agent --trust -p` review passes ended at 5/5 with no actionable findings. Fixes addressed letterbox bleed-through, one-time Undo entry, discarded stale outgoing layers, rapid rating toggles, feedback lifetime/scope, and final-photo Undo. Reviewers read code without executing tests; local checks supply execution evidence.
- Timing: baseline six samples were 63, 52, 70, 71, 55, 72 ms (median 66.5); v3 samples were 101, 41, 61, 48, 52, 56 ms (median 54). The first v3 forward sample regressed; the median improved. This small development-client run does not establish a universal speed improvement or satisfy a strict worst-case non-regression claim. Both runs used the same six swipes (three next/previous pairs) between the first two sample photos, recording device UI-thread release time through the current image's `onDisplay` callback. That includes callback delivery and is not full unobscured-photo latency: the separate outgoing overlay may still be visible. Temporary probes ran in isolated copies and are absent from the PR. This is not cold-cache RAW, physical M5, or large-library performance evidence. Local results: `evidence/preview-timing-{baseline,current}/timings.json`.

The [v2 verification record](TOUCH-VERIFICATION.md) remains historical evidence for the preserved workflow. V3 does not add real-camera RAW decoding evidence; synthetic sample NEFs, physical-device coverage, and native failure limits remain as documented there and in [VERIFICATION.md](VERIFICATION.md).

## Native walkthrough and evidence

Verified on Appetize `ipadpro129inch5thgeneration`, iPadOS 26.0, native build `b_qvj24gcu7p27wykfltbyywreci`, JavaScript revision `keeper-touch-v3`.

| Flow | Observed result / ignored local evidence |
| --- | --- |
| Keep/reject and browse without deciding | 12 scripted assertions passed: four directions, short-drag cancellation, boundaries, Undo, and last-photo no-ops. `evidence/touch-v3-swipe/`. Frame inspection of the recording distinguishes outgoing accepted swipes from springing cancellation. |
| Preserve keyboard and sidebar workflows | 13 assertions passed, including native keyboard input, direct sidebar selection, pairing/hints, and direct folder controls. Preview measured 891×669 points, maintaining 4:3 within rounding and exceeding the original 833×624 baseline. `evidence/touch-v3-legacy/`. |
| Buttons, stars, clear, and Undo | 14 assertions passed. `evidence/touch-v3-controls/`. |
| Rating toggle, feedback Undo, and completion | 12 assertions passed, including the decision badge, nonmodal completion, reopening progress, and restoring a clean review. `evidence/touch-v3-feedback-complete/`. |
| Saved review | Five assertions passed after Rescan, restoring selection, Keep/five stars, Reject, and totals. `evidence/touch-v3-persistence/`. This is not a cold process relaunch. |
| Export retains context and copies RAW | Three scripted assertions passed for confirmation and the visible locked workspace, followed by manual native Files selection and a reported verified RAW copy. `evidence/touch-v3-export/` and `touch-v3-export-result.{json,png,mp4}`. Export cancellation was not repeated in v3; v2 evidence remains applicable to the unchanged native path. |
| Open a folder, portrait sheets, final transition check | Native Files opened Sample shoot v2 with four photos from six files. A final Keep/Undo returned the original state. Portrait Photos selection and Help dismissal returned to enabled controls. `evidence/touch-v3-source*` and `touch-v3-portrait*`. |

There are **59 passing scripted native assertions**, plus the manual checks above. The first combined swipe/feedback session reached the account session limit during feedback cleanup; its incomplete feedback phase is not counted. The separate `feedback-complete` rerun passed. The final outgoing transparency and same-photo Undo adjustments received a source-folder Keep/Undo smoke check; other swipe rules were unchanged.

All created baseline/v3 sessions, recordings, Metro processes, and tunnels were stopped. The captioned v3 walkthrough is delivered separately as `evidence/keeper-touch-demo-v3.mp4`; videos, screenshots, timing probes, and session metadata remain outside git. Some footage contains the development client's blue Refreshing overlay. Appetize records at constant 30 fps, so video frame spacing is not a performance measurement.

Actual multi-touch cancellation, interrupted touches, system reduced-motion appearance, physical-device frame rate/memory pressure, audible VoiceOver, and iPadOS edge-gesture competition remain device coverage limits. The implemented reduced-motion path and guards are not evidence that those scenarios were manually exercised.
