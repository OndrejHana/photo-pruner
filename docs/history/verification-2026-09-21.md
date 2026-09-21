# Verification — 21 September 2026

The Linux → EAS → Appetize development loop works with a native Expo development client. This is a functional prototype and a verification setup, not a completed photo-management product.

## Build and local checks

- EAS account: `ondrejhana`.
- Simulator build: [fd55b836-55a9-499b-b4b1-577f7488b946](https://expo.dev/accounts/ondrejhana/projects/photo-pruner/builds/fd55b836-55a9-499b-b4b1-577f7488b946), FINISHED. The Swift module compiled in this build.
- Appetize build: `b_sk3ylstcclrmqh4eqvd5upgtpe`.
- Test device: Appetize `ipadpro129inch5thgeneration`, iPadOS 26.0, landscape. This is not the user's M5 hardware.
- `npm run check`: ESLint, TypeScript, and all eight domain tests passed.
- Expo Doctor: 21/21 checks passed during setup.
- An iOS bundle export and native-module autolinking check passed before the final error-message cleanup and revision-marker changes; the updated JavaScript subsequently ran in Appetize.
- Shell/Node syntax checks and `git diff --check` passed.

## Observed on the simulator

| Check | Result and evidence under `evidence/` |
| --- | --- |
| RAW + JPEG pairing | Six fixture files became four items. Paired items list both filenames and show the JPEG. `24-pair-rating.png` |
| Keyboard input | Actual viewer keyboard events delivered Y, N, U, arrows, and digits. Five stars + Y + Left produced a kept pair with five stars. `21-keyboard.json`; N + U left item 3 unreviewed, then 3 assigned three stars in `36-before-reload.json` |
| Touch review controls | Keep/reject advanced, stars stayed, undo restored the prior selection and decision. Fresh-session assertions passed in `scripts/verify-ui.mjs`. `22-reviewed.png`, `23-undo.png`, `24-pair-rating.png` |
| Saved reviews | Rescan reloaded the review from native storage with one kept, one rejected, and five stars on the first pair. `25-rescan.png`. Selecting Sample shoot through Files retained the review: `35-picked.png`, `36-before-reload.json` |
| Native Files picker | Opened the native folder picker, displayed sample contents, selected the folder, and returned to the app. `33-picker.png`, `35-picked.png`. An empty folder was also accepted and showed an empty state during an earlier session. |
| Unreadable RAW | An intentionally invalid RAW-only fixture showed a useful error and remained reviewable. `26-invalid-raw.png` |
| Live source edits | Footer changed from loop-1 to loop-2, and later loop-3 to loop-4, in existing sessions without a native rebuild. `37-fast-refresh.png` |

The complete fresh-session touch sequence passed all five screenshot/assertion checkpoints. A development Tools overlay initially intercepted Rescan; the connection script now disables that overlay before testing.

The last session was recorded in `evidence/final-demo.mp4` (95.5 seconds of recorded frames, about 3.3 MB). Screenshots, recordings, session logs, binaries, and signed download metadata are ignored by git.

A full Metro reload was requested at the end, but the captured UI still contained the previous in-memory key diagnostic. That evidence does **not** establish a completed full reload or cold-launch restoration. Persistence is verified by native reloads of the review during rescanning and folder selection; cold launch, backgrounding, and revoked folder permissions remain to test.

## Remaining physical-device work

- Interactive Apple authentication is required. EAS knows the Apple team and an enabled registered iPad, but no suitable internal-distribution credentials were available for this app. The interactive build reached the Apple ID prompt and was cancelled there; no device build was produced.
- Test the actual iPad keyboard, sustained/repeated keys, focus after system UI, and shortcut behavior with iPadOS accessibility settings.
- Test representative real camera RAW + JPEG pairs. The bundled NEFs are intentionally invalid and prove grouping/error behavior only. ImageIO decoding support for the user's camera is unverified.
- Test iCloud Drive, external USB/SD storage, disconnected/reconnected volumes, and durable security-scoped access across cold launches.
- Measure large folders, image latency, memory pressure, and zoom requirements on the M5. Simulator timings are diagnostics, not performance evidence.

The prototype reads direct folder children, stores app-local review metadata, and leaves original photos unchanged. It does not yet delete/move files, export XMP, recursively scan folders, or provide full-resolution zoom.

All Appetize sessions created for this milestone were ended. Follow [DEVELOPMENT.md](../DEVELOPMENT.md) to start a new session; do not rely on old tunnel URLs.
