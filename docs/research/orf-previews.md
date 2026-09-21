# Olympus ORF previews

Decision: prefer the JPEG companion, then use ImageIO for an ORF alone or when a companion cannot be read. Produce a bounded, orientation-correct preview off the UI thread. Try the embedded thumbnail first; if it is too small for the viewing area, generate a downsampled preview from the image. Try other candidates before reporting an unavailable preview.

Apple documents [system RAW support in iPadOS 26](https://support.apple.com/en-nz/122870), including many Olympus models, with exclusions for some High Res Shot modes. ORF is a container extension, not a guarantee that every camera and mode is supported. Apple provides [thumbnail generation](https://developer.apple.com/documentation/imageio/cgimagesourcecreatethumbnailatindex(_:_:_:)) and [runtime source-type discovery](https://developer.apple.com/documentation/imageio/cgimagesourcecopytypeidentifiers()). These establish the native approach, not a test result for every ORF.

Use a 4:3 preview viewport with aspect-preserving containment; no crop or full-resolution zoom is required. Cache generated previews with a bounded disk budget. Include source identity and revision in requests, coalesce obsolete requests, and keep photo navigation responsive during decoding.

Verification: use genuine, checksum-pinned Olympus ORFs from the [raw.pixls.us repository](https://raw.pixls.us/), selecting CC0 samples. Exercise standalone ORF, paired JPEG preference, an unreadable companion falling back to ORF, and an invalid ORF. The synthetic NEFs used by the original prototype do not prove decoding. The user's exact camera model is unknown; do not generalize sample results to all Olympus shooting modes.
