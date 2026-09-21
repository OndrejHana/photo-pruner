# Embedded ratings in ORF exports

Decision for v1: copy RAWs byte-for-byte, preserving existing metadata, and omit newly assigned star ratings from exports. Keep stars in the app's review data. Export no sidecars, as the user requested.

Direct embedding is possible at the file-format level: [Exiv2 lists ORF XMP write support](https://dev.exiv2.org/projects/exiv2/wiki/Supported_image_formats) and exposes an [ORF encoder](https://exiv2.org/doc/classExiv2_1_1OrfParser.html). The [XMP metadata schema includes Rating](https://exiftool.org/TagNames/XMP.html). This is not an assertion that ORFs can never contain ratings.

The current iPad app has no integrated, tested ORF metadata writer. Apple's [ImageIO guide](https://developer.apple.com/library/archive/documentation/GraphicsImaging/Conceptual/ImageIOGuide/imageio_basics/ikpg_basics.html) distinguishes source support from destination support and requires querying available encoders; decoding an ORF does not establish that ImageIO can losslessly rewrite its proprietary structure. We will not convert RAWs into rendered images or append unvalidated metadata as a substitute.

Adding and validating a separate native writer across camera variants would expand this optional feature. Under the user's explicit fallback, v1 omits it. The export screen must say that new star ratings stay in the app. Existing camera metadata is preserved by exact copying and per-file SHA-256 verification. No downstream editor compatibility has been assumed.
