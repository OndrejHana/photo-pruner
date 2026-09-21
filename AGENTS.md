# Photo Pruner

An iPad photo-culling prototype. Work from this directory.

- Use Expo development builds; the local Swift module is required.
- Original photos are read-only. Keep/reject and stars are app-local metadata.
- Never put credentials, session tokens, build archives, or recordings in git.
- Run `npm run check` for TypeScript and domain tests before building.
- Native code changes require an EAS simulator build. JS changes use Metro Fast Refresh.
- Read docs/DEVELOPMENT.md for the Linux/Appetize workflow and docs/VERIFICATION.md for evidence and limitations.
- Load Appetize credentials from /root/.config/secrets/appetize without printing them.
- End Appetize sessions created for verification when finished.
