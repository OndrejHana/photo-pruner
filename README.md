# Photo Pruner

Review a folder on your iPad and copy its RAW keepers into a new folder. Built with Expo/React Native and a local Swift module, developed from Linux with EAS and Appetize.

- Open a folder in Files; RAW + JPEG companions appear as one item. RAW-only items are supported, with Olympus ORF as the v1 target.
- Review with **Y** keep, **N** reject, arrows, **1–5** stars, **0** clear stars, and **U** undo. Keep/reject advances; stars stay on the current item.
- See a contained preview in a **4:3** window, using JPEG companions first and ImageIO for RAW previews.
- Autosave decisions on the iPad and restore them when reopening the source folder.
- Export explicitly kept RAW files into a unique new folder under a destination chosen in Files. Verify every copy, support cancellation, and leave source files unchanged.

Stars remain in the app. Export preserves RAW bytes and their existing metadata; it does not add ratings or sidecars. Unreviewed items, JPEG companions, and kept items without RAW files are excluded from export. The app scans direct children of the chosen folder, without recursion.

See [workflow rules](docs/V1-WORKFLOW.md), the [wayfinder map](https://github.com/OndrejHana/photo-pruner/issues/1), and [verification evidence and limits](docs/VERIFICATION.md). PRs require an external **5/5** review of the current revision before merging.

## Run on an iPad

The `preview-device` EAS profile creates a standalone internal-distribution app with bundled JavaScript. Install it through its EAS build link; it does not require a development server. The device must be registered in the signing profile.

For development, install the `development-device` build and connect it to the Metro URL printed by `scripts/start-dev.sh`. Expo Go cannot run the local Swift module. Native changes require reinstalling a compatible build; older clients show an update message.

## Develop and test

```sh
npm ci
npm run check
./scripts/start-dev.sh
```

On a Mac, or in the macOS CI job:

```sh
python3 scripts/download-orf-fixtures.py
ORF_FIXTURES="$PWD/artifacts/fixtures" swift test
```

Read [the development workflow](docs/DEVELOPMENT.md) for builds and the Linux/Appetize loop. Fixture downloads, previews, screenshots, recordings, and build archives stay outside git.

## Samples

The Sample shoot button creates three synthetic JPEG images and three deliberately invalid `.NEF` files in Documents/Sample shoot. They form four items: two pairs, one JPEG-only item, and one RAW-only item. These exercise grouping, keyboard controls, export mechanics, and preview errors; they are not real RAW photos.

Native CI separately downloads SHA-256-verified CC0 Olympus E-P3 and E-M1 Mark II ORFs from [raw.pixls.us](https://raw.pixls.us/). Both produce 2400×1800 previews. Camera modes beyond these samples still need validation on the target iPad.
