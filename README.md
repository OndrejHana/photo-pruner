# Photo Pruner

An iPad photo-culling prototype built and tested from Linux using Expo/EAS and Appetize.

- Open a folder through the native Files picker; reopen it using an iOS bookmark.
- Group RAW + JPEG companions by filename stem, with JPEG previews preferred.
- Browse using arrows, keep with Y, reject with N, rate with 1–5, clear stars with 0, undo with U.
- Keep/reject advances; setting stars stays on the current photo.
- Store decisions separately in the app's Application Support directory. Original files are never modified or deleted.
- Generate scaled previews on a native worker queue and prefetch the next image.

This is an iOS-only development build. Expo Go cannot run its local Swift module.
The initial prototype scans direct children of a folder, not subfolders.
It does not export XMP or perform file deletion/moves yet.

## Develop

```sh
npm ci
npm run check
./scripts/start-dev.sh
```

Read [the development workflow](docs/DEVELOPMENT.md) and [verification results](docs/VERIFICATION.md).

## Samples

The Sample shoot button creates three synthetic JPEG images and three deliberately invalid `.NEF` files in Documents/Sample shoot. They form four logical items: two pairs, one JPEG-only item, and one RAW-only item. This tests pairing, JPEG preview preference, and graceful preview errors. It does not establish support for any camera RAW decoder.
