# Photo Pruner

An iPad photo-culling prototype. Work from this directory.

- Use Expo development builds; the local Swift module is required.
- Original source photos are read-only. Export operates on copies; embedded ratings are conditional on the wayfinder investigation.
- Never put credentials, session tokens, build archives, or recordings in git.
- Run `npm run check` for TypeScript and domain tests before building.
- Native code changes require an EAS simulator build. JS changes use Metro Fast Refresh.
- Read docs/DEVELOPMENT.md for the Linux/Appetize workflow and docs/VERIFICATION.md for evidence and limitations.
- Load Appetize credentials from /root/.config/secrets/appetize without printing them.
- End Appetize sessions created for verification when finished.

## Agent skills

### Issue tracker

Use GitHub Issues in `OndrejHana/photo-pruner`. See `docs/agents/issue-tracker.md` for wayfinder maps, child issues, dependencies, and claims.

### Domain docs

This is a single-context project. Read `CONTEXT.md` for terminology and `docs/agents/domain.md` for documentation conventions.
