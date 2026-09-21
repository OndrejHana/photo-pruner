---
name: appetize
description: >-
  Run, inspect and control iOS/Android apps on Appetize cloud devices via the
  appetize CLI. Use when running, testing or debugging a mobile app build
  (.app/.apk) on a simulator/emulator — starting sessions, tapping/typing via
  selectors, taking screenshots. Reach for this whenever a task means exercising
  a mobile app on a real device rather than reading its source: verifying a UI
  change, reproducing a bug report, walking through a signup or checkout flow,
  or answering what is currently on screen — even if Appetize is not mentioned
  by name.
metadata:
  cli-version: '0.16.0'
---

# Appetize

Drive an iOS or Android app on a cloud device with the `appetize` CLI. You get a
real simulator or emulator: you can see the view hierarchy, act on it, and
screenshot the result.

The single most important habit: **look before you act, and verify after**. You
cannot see the screen directly, so `inspect` and `screenshot` are your eyes.
Acting blind on remembered coordinates is the main way these sessions go wrong.

## Prereqs

Confirm the CLI is installed and note the version:

```bash
appetize --version
```

`APPETIZE_API_TOKEN` must be set for private APIs and session targets. A target
is an uploaded build's public key, e.g. `app_a1b2c3`. Discover one with
`appetize build list`, filtering with `--app <appId>` when you know the bundle
or package id.

Put a local `.apk`, `.zip` or `.tar.gz` on the platform with
`appetize build upload ./app.apk`. The extension tells Appetize which platform
the build targets, and the `id` it prints is a target you can start a session
against immediately.

A device id names a model, e.g. `iphone15pro`. Discover valid ids and the OS
versions each supports with `appetize device list`, filtering with
`--platform ios` or `--platform android`.

`APPETIZE_ENDPOINT` sets the Appetize URL, so a non-production environment is
configured once rather than flagged on every session.

## Session lifecycle

Start a session, naming a device and a target:

```bash
appetize session start iphone15pro app_a1b2c3
appetize session start pixel7 app_a1b2c3 --device-os-version 14
```

This blocks until the device is ready, then prints the session:

```json
{
  "adbSerial": "127.0.0.1:44555",
  "baseUrl": "https://lax4b-android-9.appetize.io",
  "controlSocket": "/home/you/.appetize/cli/sessions/tidy-pandas-jump/control.sock",
  "logs": {
    "daemon": "/home/you/.appetize/cli/sessions/tidy-pandas-jump/daemon.log",
    "device": "/home/you/.appetize/cli/sessions/tidy-pandas-jump/device.log.jsonl"
  },
  "sessionId": "tidy-pandas-jump",
  "viewerUrl": "http://127.0.0.1:4321/"
}
```

- `sessionId` — what every later command takes
- `adbSerial` — Android only; `adb connect` it to use adb
- `viewerUrl` — local browser viewer for co-driving
- `baseUrl` — the streaming host serving the session
- `controlSocket` — where the daemon listens
- `logs.device` — the device's own logs; `logs.daemon` is the CLI's

A background daemon holds the session open.

With one session running, the other commands find it automatically — you do not
need to pass anything. If you start several, pass `--session-id <id>` to pick
one, or name them yourself by passing `--session-id` to `session start`.
`--no-wait` returns immediately with just `sessionId` and `logs`, useful when you
want to do other work while the device boots.

The daemon streams device logs as JSONL to `logs.device`. Read or `tail -f` it
when you need to see what the app itself is reporting — a crash, a failed
request, a log line your change was supposed to emit.

Starting with `--proxy` also captures the app's network traffic as JSONL to
`logs.network`. Each line is a request, response or error
event, so it answers what the app actually sent and what the server actually
returned — useful when the app's own logs do not say:

```bash
jq 'select(.type == "response") | "\(.response.status) \(.request.method) \(.request.url)"' network.jsonl
```

Stop the session when you are done, so the device is released:

```bash
appetize session stop
```

Session state lives in `~/.appetize/cli/sessions/<session-id>/state.json` (or under
`$APPETIZE_CLI_HOME`). Reading it is a good way to see what a session is doing
without disturbing it. `logs.daemon` holds the daemon's own output — read that
when the session itself misbehaves, rather than the app.

## Recording the screen

Video is not captured unless you ask for it — nothing streams from the device
until you start:

```bash
appetize recording start login-flow
appetize recording stop
```

`recording start` has the daemon open the video stream and write it to the file
you name, printing the path. The name is required; `.mp4` is added if you omit
it, and the directory must already exist. `recording stop` closes the stream and
the file. Starting again while one is already running fails, whatever path you
name, so a recording always begins where you asked it to. Ending the session
while recording closes the file cleanly. Recording over an existing file fails unless
you pass `--force`, so name a new file to record again in the same session.

Any player opens it. A session that dies unexpectedly still leaves the file
playable, losing at most the last second.

Playback is a constant 30fps, so it does not track real time.

## The loop

### 1. Inspect first

```bash
appetize inspect --select-test-id login-form
```

`inspect` writes the view hierarchy as JSON to `inspect.json` by default (name
a path to choose another, `--pretty` to indent) and prints a summary — byte
count, node count, output path — so you know what you got.

Scope it with a selector and read the file rather than dumping it to the
terminal. An unscoped hierarchy on an ordinary screen runs past 100 KB, which
buries the thing you were looking for and wastes most of your context.

The tree contains **only what is currently on screen**. An element that is
scrolled away or covered is not in it — absence means "not visible right now",
not "does not exist".

### 2. Act through selectors

Prefer matching what an element _is_ over where it happens to sit:

```bash
appetize tap --select-test-id save
appetize tap --select-text 'Log in'
appetize tap --select-text '/^item \d+/i' --select-index 2
appetize type 'user@example.com{Tab}hunter2{Enter}'
appetize swipe --direction up
appetize swipe --from-test-id card-3 --to-test-id archive-bin
```

`swipe` comes in two shapes. A `--direction` scrolls the screen (add
`--distance` for a fraction of it), while a `--from-*`/`--to-*` pair drags along
a path between two points — which is how you reorder a list or drop something on
a target. Both ends take the same selectors as `tap`, so a drag can name its
endpoints instead of guessing coordinates:

```bash
appetize swipe --direction left --from-test-id card --from-index 1
appetize swipe --from-text 'Drag me' --from-y 0.9 --to-test-id drop-zone
```

`--select-test-id` is the most durable, then `--select-text` (an exact string,
or `/regex/flags`). `--select-index` picks among multiple matches, 0-based.
Coordinates (`--select-position 0.5,0.75`) still work and are the right tool for
canvases, maps and sliders — but a selector survives layout changes and a
coordinate does not.

In `type`, `{...}` names a key: `{Enter}`, `{Tab}`, `{Backspace}`, the arrows.
`{Backspace>16/}` repeats one 16 times, and `{{` types a literal `{`.

### 3. Verify

```bash
appetize screenshot after-login
```

Screenshot after each meaningful step. A tap that "succeeded" only means the
gesture was delivered — the app may still have shown an error, stayed put, or
navigated somewhere unexpected. The name is optional and the extension is added
for you.

### 4. Wait by inspecting, not by sleeping

```bash
appetize inspect --select-test-id home-feed --timeout 5000
```

`--timeout <ms>` makes the command wait for the element and fail with a non-zero
exit if it never appears. That is your wait primitive: it returns the moment the
element is there, and it tells you clearly when it is not. Sleeping guesses, and
guesses are either slow or flaky.

### 5. Change the code, reinstall, repeat

When the app itself is what you are changing, keep the session running and put
each new build on the device rather than starting over.

On Android, install the APK directly over adb:

```bash
adb connect <adbSerial>
adb -s <adbSerial> install -r ./app/build/outputs/apk/debug/app-debug.apk
```

This replaces the app in place and takes seconds. The `adbSerial` is the one
`session start` printed. Keep reading the app's logs from `logs.device`.

On iOS there is no direct install: a simulator build has to be produced by the
project's CI (a workflow that archives the `.app` and uploads it to Appetize,
often via `appetize build upload` or the Appetize upload action). Find that
workflow, push your change so it runs, then restart the session against the
build id it produced:

```bash
appetize session stop
appetize session start iphone15pro <new-id>
```

If you cannot tell from the repository's CI configuration how an iOS build
reaches Appetize, stop and ask how the change should be verified rather than
guessing.

Either way, go back to step 1 and inspect — do not assume the new build is
running until you have seen it.

### 6. Show your work

When a step changes what is on screen, or reaches a state worth seeing, take a
screenshot and read the image into the transcript as you go. The person driving
sees what you see, rather than a description of it.

When a turn ends with a visual change or a final state that deserves a demo,
record the flow and surface the video the same way:

```bash
appetize recording start demo
# drive the flow
appetize recording stop
```

Where your environment lets you attach media to a pull request, include the
screenshots or video in the description as evidence of the change. Otherwise the
transcript is the record — never commit screenshots or recordings to the repo.

## Troubleshooting

| What you see                                     | What it means                                                 |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `No active sessions`                             | Nothing is running — `session start` first.                   |
| `Multiple active sessions; specify --session-id` | Pass the `sessionId` of the one you want.                     |
| `No session found for id X`                      | That session ended, or the id is wrong.                       |
| Element not found                                | Re-inspect. It is off screen, covered, or the screen changed. |
| App fails only on network calls                  | If you started with `--proxy`, retry without it.              |

A session moves through phases while starting: `requesting`, `queued`,
`starting`, `downloadingApp`, `installingApp`, `launchingApp`, `ready`. If
`session start` is taking a while, that sequence tells you whether you are
queued for capacity or waiting on an install.

## Dismissing the soft keyboard

There is no `hideKeyboard` command, so the keyboard is dismissed differently on
each platform. Tapping an inert element does **not** work: it only clears focus
if the app wired that up, and many apps do not.

**iOS** — press the return key:

```bash
appetize type '{Enter}'
```

**Android** — press the back button; while the keyboard is up it dismisses
the keyboard instead of navigating back:

```bash
appetize press back
```

Both leave you on the same screen with the field still focused. Confirm from
`inspect`: on Android the IME contributes nodes with `inputmethod`, `ime` or
`latin` in their identifiers, and on iOS its keys appear as nodes labelled `q`,
`space` and `return`. When those are gone, the keyboard is down. Since the tree
holds only what is visible, a field the keyboard covers simply is not there,
which is the symptom that sends you here.

Resist the urge to make this easier by changing the app under test — adding a
test id or a dismiss button changes the thing you are supposed to be verifying.

## Full command reference

`references/commands.md` has every command, flag, output shape and exit
behaviour. Read it when you need a flag this page does not cover, or run
`appetize <command> --help`.
