# Verification — 22 September 2026

The v1 implementation is in three stacked PRs. External reviews have resumed: the domain-model PR received 5/5 and merged. The native review found a case-sensitive filename edge case; preview lookup now permits RAW name collisions while export still rejects them. Updated native and UI revisions require fresh 5/5 reviews before merging. The [wayfinder map](https://github.com/OndrejHana/photo-pruner/issues/1) tracks the merge gate and remaining device coverage.

## Automated checks

- `npm run check`: ESLint, TypeScript, and 19 tests pass. Tests cover grouping, export selection and filename collisions, review validation/serialization, keyboard commands, 5,000-request preview/save bursts, stale results, save failures, and held-key undo preservation on the last photo.
- macOS CI previously passed six Swift tests; a seventh regression now checks JPEG preview with conflicting RAW filenames and continued export rejection. They cover byte-for-byte multi-file exports, unique destination folders, invalid/non-RAW selections, cancellation cleanup, changed sources, symlinks, preview fallback, and cache eviction.
- Real CC0 Olympus E-P3 and E-M1 Mark II ORFs both produced 2400×1800 JPEG previews. Downloads are SHA-256 checked against [the fixture manifest](../tests/fixtures/orf-manifest.json). Preview images are CI artifacts, not repository files.
- [Combined CI run](https://github.com/OndrejHana/photo-pruner/actions/runs/35667145350) passed both JavaScript and native jobs.
- [EAS simulator build](https://expo.dev/accounts/ondrejhana/projects/photo-pruner/builds/9acb8391-c2b3-45d1-bebd-938578e731cd) finished and compiled the complete Swift/Expo bridge for iOS.
- [EAS development build for the registered iPad](https://expo.dev/accounts/ondrejhana/projects/photo-pruner/builds/ae5bf7af-a0d3-4edc-8083-ddbb4d303fef) finished using the existing signing credentials.

- [Standalone build for the registered iPad](https://expo.dev/accounts/ondrejhana/projects/photo-pruner/builds/198adbc2-137d-41f1-9fce-a89ba9d87043) finished from commit `5a25d1c`. Archive inspection confirmed a 1,503,868-byte bundled JavaScript file, the expected bundle identifier, and iPad support. It does not need Metro.

## Observed on iPadOS 26.0 in Appetize

Used `ipadpro129inch5thgeneration`, Appetize build `b_4dhn2wfrivw64tfp3kot3ofe2e`. This is not the user's M5 hardware. Three short sessions were used (each limited to approximately three active minutes) and all ended; no additional sessions should be started without accounting for the remaining allowance.

| Check | Observation / ignored local evidence |
| --- | --- |
| Hardware key events | 5, Y, N, U and arrows produced one kept pair with five stars and one rejected pair. Assertions passed against `evidence/keeper-keys.json`. |
| 4:3 preview | Measured 833×624 points in landscape (pixel rounding) and 744×558 in portrait. Images were contained. `keeper-start.png`, `keeper-portrait.png`. |
| Export confirmation | Reported one RAW file, two skipped unreviewed items, and in-app-only ratings. `export-confirm.png`. |
| Native destination picker | Selected the app's Documents directory as the parent. `export-picker.png`. |
| Completed export | Reported one verified copy in a new Keepers folder. Reopening Files showed that folder with one item beside the unchanged six-file sample source. `export-result.png`, `orf-open-folder.png`. |
| Persistence | After keyboard review and Rescan, native storage restored Keep and five stars on DSC_0001. Assertions passed against `persisted-review-all.json`. |
| Returning from system UI | The app accepted keyboard input after returning from Safari and reopening the sample. |

The main recording is `evidence/keeper-v1-demo.mp4` (166.6 seconds). Screenshots, videos, downloaded photos, logs, session data, and signed build metadata are ignored by git. The final session ran the updated label/truncation and held-key fix; the held-key edge case itself is covered by the regression test, not a simulator assertion.

The bundled sample RAW files are intentionally invalid NEFs. Their export verifies the native Files/copy workflow, not ORF decoding. Safari initially exposed an offscreen duplicate Download button. A later attempt targeted the visible button, downloaded the 11.9 MB E-P3 ORF, and opened it successfully in iPadOS system Quick Look (`final-download-list.png`, `orf-preview-system.png`). The file was not accessible through Photo Pruner's folder picker before the session ended. **Our app's real ORF rendering is verified in macOS CI; iPadOS system preview is separate evidence and does not establish an in-app ORF check.** No RAW files were embedded into the app solely for this check.

## Limits and remaining coverage

- Validate the user's actual Olympus camera modes and keyboard on the physical M5 iPad. ImageIO support is camera/mode dependent; see [ORF research](research/orf-previews.md).
- Cold process relaunch, revoked folder permissions, OS termination during export, and low-disk failures have not been manually exercised on iPadOS. Saved-review loading on rescan, cancellation cleanup, and source-change failures have automated or simulator evidence as described above.
- Burst tests prove bounded asynchronous work; they are not measurements of real M5 image latency, memory pressure, or 5,000-file scanning performance.
- Cloud storage, external drives, recursive scans, and zoom are outside v1 requirements.
- Newly assigned ratings stay in the app. Exported files are byte-for-byte copies; no embedded rating writer or sidecars are included.

The [original prototype verification](history/verification-2026-09-21.md) is retained as historical evidence; its earlier signing block has since been resolved.
