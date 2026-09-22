# RAW keeper workflow v1

The [wayfinder map](https://github.com/OndrejHana/photo-pruner/issues/1) holds the agreed user scope. The remaining choices below are implementation defaults selected under the user's authorization to execute the whole map; they are not additional user interview answers.

- Only explicit Keep decisions export. Stars do not imply Keep. Unreviewed items are skipped and counted in the export confirmation. Kept items without a RAW are also counted and skipped.
- Export every RAW companion of a kept item, including standalone ORFs. Leave JPEG companions and all source files in place. An unavailable preview does not prevent deliberately keeping a RAW.
- Choose a destination parent through Files. Each export creates a new, uniquely named `Keepers` folder under that parent. Never overwrite existing files or merge with an older export.
- Stage work in a separately named incomplete folder. Publish the final folder only after every selected file has been copied and its bytes verified. On an ordinary failure or cancellation, remove only this operation's staging folder. If cleanup fails, report its name; do not report success. A process termination can leave an explicitly incomplete folder, never a falsely complete keepers folder. Retry starts a new export.
- Keep the source selection fixed during export. Reject stale folder revisions or files changed since the scan. Read and write under file coordination, with security-scoped access for the destination.
- Save review progress automatically, serialize/coalesce writes, and surface save errors. Opening another folder, rescanning, and exporting must first flush the current review. Preserve corrupt saved data and disable destructive overwrites of it.
- Pause review shortcuts during system pickers and export. Restore focus when returning to the app. Keep the 4:3 viewing area inside the available landscape or portrait space without stretching or cropping the photo.
- Do not add embedded star ratings in v1; explain this at export. See [the embedded-ratings investigation](research/embedded-ratings.md).

## Acceptance

Local/CI checks cover 5,000 logical photos as an engineering baseline (not a claimed user workload or a measured iPad throughput target), RAW-only exports, preview candidate order, malformed review data, unusual filenames, rapid navigation, coalesced persistence, copying failures/cancellation, changed inputs, destination collisions, and exact copy verification.

A prepared native run must verify real ORF preview, keyboard review, the 4:3 viewport, folder selection, exported file counts, persistence after reload, and a recoverable preview error. Prefer macOS/iOS CI checks for native file behavior and reserve Appetize minutes for interaction that cannot be established locally. Document physical-device and camera-mode limits honestly.

## Delivery gate

Use focused pull requests. Each PR requires the external reviewer's **5/5** rating on its current revision before merging. A rating on an older head does not authorize merging newly changed code. CI must also pass. Do not self-assign the external reviewer's grade.
