# Command reference

Every command, flag and output shape. `appetize <command> --help` prints the
same flags at the terminal.

- [Global](#global)
- [session start](#session-start)
- [session stop](#session-stop)
- [build list](#build-list)
- [build upload](#build-upload)
- [device list](#device-list)
- [inspect](#inspect)
- [tap](#tap)
- [swipe](#swipe)
- [type](#type)
- [press](#press)
- [rotate](#rotate)
- [screenshot](#screenshot)
- [recording start](#recording-start)
- [recording stop](#recording-stop)
- [skill install](#skill-install)
- [Selectors](#selectors)
- [Environment](#environment)
- [Exit codes and output streams](#exit-codes-and-output-streams)

## Global

`--session-id <id>` is accepted by every command except those marked "Takes
no session". On
`session start` it names the session being created; everywhere else it picks
which existing session to act on, defaulting to the sole active one, so pass it
only when several are running.

## session start

```
appetize session start <device-id> <target> [options]
```

| Flag                  | Meaning                                                |
| --------------------- | ------------------------------------------------------ |
| `--device-os-version` | Device OS version, e.g. `17` for iOS, `14` for Android |
| `--endpoint`          | Appetize URL; overrides `APPETIZE_ENDPOINT`            |
| `--no-wait`           | Return without waiting for the device to be ready      |
| `--proxy`             | Proxy traffic: `intercept`, or a custom `http://` url  |
| `--session-id`        | Name the session; defaults to a generated 3-word id    |

Spawns a daemon that holds the session open and prints JSON on stdout. Waiting
(the default) prints
`{ adbSerial, baseUrl, controlSocket, logs, sessionId, viewerUrl }`
once the device is ready; `--no-wait` prints `{ logs, sessionId }` immediately.
`adbSerial` is present only for an Android session, and only while adb is
available to it: `adb connect <adbSerial>` attaches to the device until the
session ends. `viewerUrl` opens the local browser viewer. `logs`
carries a `device` and a `daemon` path, plus a `network` path — the JSONL capture
of the app's traffic — when started with `--proxy` (or `--proxy intercept`). Progress phases are logged to stderr:
`requesting`, `queued`, `starting`, `downloadingApp`, `installingApp`,
`launchingApp`, `ready`.

Network traffic can be proxied or intercepted for debugging. `--proxy` (or
`--proxy intercept`) provisions the intercepting proxy so traffic can be
captured; `--proxy http://host:port` routes through a proxy of your own, and the
streaming server rejects any other scheme. Interception rewrites TLS, so an app
that pins certificates may not work under it.

`sessionId` is what every other command takes. A generated one looks like
`tidy-pandas-jump`; a name you pass may use letters, digits, `.`, `-` and `_`,
and starting a session with an id already in use fails.

## session stop

```
appetize session stop
```

Signals the daemon to shut down and prints `{ ended: true, sessionId }`. Reports
the id even if the daemon had already exited, so it is safe to call twice.

## build list

```
appetize build list [options]
```

| Flag         | Meaning                                     |
| ------------ | ------------------------------------------- |
| `--app`      | App id to filter by (bundle or package id)  |
| `--endpoint` | Appetize URL; overrides `APPETIZE_ENDPOINT` |
| `--limit`    | Builds per page (default 10, max 200)       |
| `--page`     | Page of results to fetch (default 1)        |

Lists one page of the account's uploaded builds, newest first, printing
`{ builds, nextPage, total }` on stdout. Each build's `id` is a target
`session start` takes, alongside `appId`, `platform`, `versionName`,
`buildNumber` and `created`. Pass a non-null `nextPage` back as `--page` to
continue. Requires `APPETIZE_API_TOKEN`. Takes no session.

## build upload

```
appetize build upload <file> [options]
```

| Flag         | Meaning                                             |
| ------------ | --------------------------------------------------- |
| `--endpoint` | Appetize URL; overrides `APPETIZE_ENDPOINT`         |
| `--note`     | Note to store with the build                        |
| `--tags`     | Comma separated tags to store with the build        |
| `--timeout`  | Milliseconds to wait with `--wait` (default 120000) |
| `--wait`     | Wait for the app id and version metadata to resolve |

Uploads a `.apk`, `.apks`, `.zip` or `.tar.gz` and prints
`{ created, id, platform }` on stdout, where `id` is a target `session start`
takes. The id is also logged to stderr as soon as the upload lands.

The extension decides the platform — `.apk` and `.apks` are Android, `.zip`,
`.tar.gz` and `.tgz` are iOS — and any other file is refused before uploading.

Appetize fills in `appId`, `versionName` and `buildNumber` by processing the
file after the upload responds, which takes a few seconds and is not needed to
start a session. `--wait` polls until they appear and prints the full
`build list` shape, failing once `--timeout` elapses.

Requires `APPETIZE_API_TOKEN`. Takes no session.

## device list

```
appetize device list [options]
```

| Flag         | Meaning                                     |
| ------------ | ------------------------------------------- |
| `--endpoint` | Appetize URL; overrides `APPETIZE_ENDPOINT` |
| `--platform` | Platform to filter by: `ios` or `android`   |

Lists available device models, printing `{ devices }` on stdout. Each device's
`id` is the `<device-id>` `session start` takes, alongside `name`, `platform`
and `osVersions` — the values `--device-os-version` accepts. Needs no
`APPETIZE_API_TOKEN`. Takes no session.

## inspect

```
appetize inspect [output] [options]
```

| Flag                                                  | Meaning                                            |
| ----------------------------------------------------- | -------------------------------------------------- |
| `--select-text`, `--select-test-id`, `--select-index` | Scope to one element — see [Selectors](#selectors) |
| `--timeout`                                           | Milliseconds to wait for the element               |
| `--pretty`                                            | Indent the JSON                                    |

`output` defaults to `inspect.json`; `.json` is added if you omit an extension.
Writes the hierarchy to that file and prints `{ bytes, nodes, output }` on stdout.
The JSON is `{ platform, root }`, where each node carries `attributes`, `bounds`
and `children`. Only currently visible elements appear.

Unscoped output on an ordinary screen exceeds 100 KB, so prefer a selector and
read the file.

## tap

```
appetize tap [options]
```

| Flag         | Meaning                                                  |
| ------------ | -------------------------------------------------------- |
| `--select-*` | Element or position to tap — see [Selectors](#selectors) |
| `--timeout`  | Milliseconds to wait for the element                     |

Prints `{ tapped: true }`. Combining an element selector with `--select-x` /
`--select-y` taps a point within that element, and values outside `0-1` are
allowed to reach just beyond its edge (e.g. `--select-x=-0.1`).

## swipe

```
appetize swipe [options]
```

| Flag          | Meaning                                                |
| ------------- | ------------------------------------------------------ |
| `--direction` | `down`, `left`, `right` or `up`                        |
| `--distance`  | Travel as a fraction of the screen (0-1)               |
| `--from-*`    | Where the gesture starts — see [Selectors](#selectors) |
| `--to-*`      | Where the gesture ends — see [Selectors](#selectors)   |
| `--duration`  | Milliseconds the gesture travels for                   |
| `--timeout`   | Milliseconds to wait for any `--from`/`--to` elements  |

Prints `{ swiped: true }`. Two shapes are valid: a `--direction` with an
optional `--from-*` starting point, or both a `--from-*` and a `--to-*` point to
form a path. Mixing `--direction` with `--to-*` is an error, as is `--distance`
without `--direction`.

## type

```
appetize type <text> [options]
```

| Flag      | Meaning                            |
| --------- | ---------------------------------- |
| `--delay` | Milliseconds to wait between steps |

Prints `{ typed: true }`. Bare text is delivered as a string; `{...}` names a
key delivered as a keystroke. Supported keys: `ArrowDown`, `ArrowLeft`,
`ArrowRight`, `ArrowUp`, `Backspace`, `Enter`, `Tab`. A token may carry a repeat
count as in `{Backspace>16/}`, and `{{` types a literal `{`. An unclosed token
or an unsupported key name fails without typing anything.

Typing does not focus a field — tap it first.

## press

```
appetize press <button>
```

Prints `{ pressed: true }`. Buttons: `home` and `lock` on both platforms;
`back`, `menu`, `unlock`, `volumeUp` and `volumeDown` on Android only. Calling
an Android-only button on iOS fails.

There is no keyboard-dismiss action. To dismiss the soft keyboard, see the
main page.

## rotate

```
appetize rotate <orientation>
```

Prints the resulting orientation. Orientations: `portrait`, `landscapeLeft`,
`landscapeRight`, `upsideDown`.

## screenshot

```
appetize screenshot [output]
```

`output` defaults to `screenshot`, and an extension matching the image is added
if you omit one. Writes a PNG and prints `{ bytes, mimeType, output }`.

## recording start

```
appetize recording start <output> [options]
```

| Flag      | Meaning                                 |
| --------- | --------------------------------------- |
| `--force` | Overwrite the file if it already exists |

Asks the daemon to open the device video stream and capture it to `output`,
printing `{ path, recording: true }`. Capture is opt-in — video is lazy
device-side, so nothing streams until this runs.

`output` is required. `.mp4` is added if you omit an extension, any other
extension is refused, and the directory must already exist. A relative path
resolves against your shell rather than the daemon's.

Starting while a recording is already running fails, whatever path you name —
adopting it would hand you a file that began whenever the first call did.

The daemon owns the stream and the file, so the command returns as soon as
capture is running.

## recording stop

```
appetize recording stop
```

Closes the stream and the file, printing `{ path, recording: false }`. Fails
with `No video recording in progress` when nothing is recording. Ending the
session while recording closes the file too, noting it in `daemon.log`.

A session that dies unexpectedly still leaves the file playable, losing at most
the last second.

Every frame is written at a constant 30fps, so playback does not track real
time. A rotation keeps the original dimensions and is noted in `daemon.log`.

Recording over an existing file fails unless you pass `--force`, so name a new
file to record more than once in a session.

`output` is resolved and checked by the CLI, so a bad path fails before the
daemon is contacted.

A write failure is reported once the recording stops, not when it happens.

## skill install

```
appetize skill install [options]
```

| Flag      | Meaning                                                        |
| --------- | -------------------------------------------------------------- |
| `--agent` | `agents`, `claude`, `codex`, `copilot` or `cursor`; repeatable |
| `--scope` | `project` (default), or `user` for your home directory         |

Installs this skill for each agent whose directory is already present — Claude
Code reads `.claude/skills`, the others `.agents/skills` — and into both when
none is found. `--agent` names agents directly instead. Takes no session.

## Selectors

Selector flags come as a prefix naming which point is being selected, plus a
suffix naming how. The prefixes:

- `inspect --select-*`
- `tap --select-*`
- `swipe --from-*` and `swipe --to-*`

Element suffixes, identical under every prefix:

| Flag                 | Meaning                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `--<prefix>-text`    | Exact string, or `/regex/flags` such as `/sign in/i`                                                                  |
| `--<prefix>-test-id` | Exact match — on Android the whole `resource-id` or the part after its last `/`, on iOS the `accessibilityIdentifier` |
| `--<prefix>-index`   | Which match when several, 0-based                                                                                     |

So `inspect --select-text 'Log in'`, `tap --select-test-id save` and
`swipe --from-test-id card --to-test-id bin` all name elements the same way.

Position suffixes, accepted by `tap` and `swipe` (not `inspect`):

| Flag                           | Meaning                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `--<prefix>-position`          | Screen position as `x,y`, each 0-1, e.g. `0.5,0.75`                                          |
| `--<prefix>-x`, `--<prefix>-y` | Position within the matched element (0-1, negative/>1 to reach outside the selected element) |

Pick one kind of match per point. Prefer a test id, then text; reach for a
position when the target has no identity of its own, such as a canvas or a
slider track.

## Environment

| Variable             | Meaning                                        |
| -------------------- | ---------------------------------------------- |
| `APPETIZE_API_TOKEN` | Authorizes private APIs and session targets    |
| `APPETIZE_ENDPOINT`  | Appetize URL used when `--endpoint` is omitted |
| `APPETIZE_CLI_HOME`  | Overrides the session state directory          |

Session state is written to `~/.appetize/cli/sessions/<session-id>/state.json`.
Device logs stream as JSONL to `device.log.jsonl` beside it, and the daemon's
own output goes to `daemon.log`.

## Exit codes and output streams

Commands exit `0` on success and non-zero on failure, printing the message to
stderr. A selector `--timeout` that expires is a failure, which is what makes it
usable as a wait.

Machine-readable results go to stdout as JSON. Progress and errors are always
stderr.

Common failures:

| Message                     | What to check                                                                     |
| --------------------------- | --------------------------------------------------------------------------------- |
| `No active sessions`        | `session start` first; if one should be live, its `daemon.log` says why it exited |
| `No session found for id X` | `endedReason` in the session's `state.json`                                       |
| `Session is not ready`      | `state.phase` in `state.json` says how far it got                                 |
