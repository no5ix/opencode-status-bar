# OpenCode Status Bar

A lightweight TUI status bar plugin for [OpenCode](https://opencode.ai/)
that displays useful information about the current AI coding session.

The status bar is rendered at the bottom of the OpenCode TUI and can
display:

-   Current task elapsed time
-   Token generation speed
-   Decode speed
-   Session cost
-   Time to first token
-   Last-turn duration
-   Prompt cache hit rate
-   Context-window usage (OpenCode vs. MTPLX resolved limit)
-   Todo progress
-   Pending permissions/questions

The plugin is provider-agnostic and works from OpenCode session/message
state rather than using model-specific logic.

------------------------------------------------------------------------

## Features

### Stopwatch

Displays the elapsed time for the current task.

Example:

``` text
⏱ 4s
```

The stopwatch:

1.  Starts when you submit a prompt.
2.  Continues while OpenCode is reasoning, calling tools, using MCP, and
    processing multiple assistant messages.
3.  Stops when the session becomes idle.
4.  Keeps the final duration visible after the task finishes.
5.  Resets and starts again when the next prompt is submitted.

This makes it useful for measuring the actual end-to-end time of an
OpenCode task.

------------------------------------------------------------------------

### Prompt Send Timestamp

Displays the local time when the prompt was submitted.

Example:

``` text
↩︎ 19:00
```

The timestamp:

1.  Records the time when a new prompt is submitted.
2.  Remains frozen while the task is running.
3.  Stays visible after the task finishes.
4.  Updates only when the next prompt is submitted.

This makes it easy to see when each OpenCode task started.

------------------------------------------------------------------------

### Token Speed

Displays the assistant's token generation rate.

Example:

``` text
⚡ 106.3 tok/s
```

While the model is generating, this shows a live rate.

After the response completes, it shows the final end-to-end throughput
for the assistant message.

------------------------------------------------------------------------

### Decode Speed

Displays the estimated decode-only token generation speed.

Example:

``` text
decode 142.7 tok/s
```

This attempts to exclude the time spent waiting for the first streamed
token.

------------------------------------------------------------------------

### Cost

Displays the cumulative cost of assistant messages in the current
session.

Example:

``` text
$0.1234
```

For costs of \$1 or more, the display uses two decimal places:

``` text
$1.23
```

------------------------------------------------------------------------

### TTFT

Displays Time To First Token.

Example:

``` text
ttft 0.42s
```

This measures the time between the assistant message starting and the
first streamed message part being received.

------------------------------------------------------------------------

### Duration

Displays the completed assistant message's wall-clock duration.

Example:

``` text
8.3s
```

This is different from the stopwatch.

-   `dur` = duration of the completed assistant message.
-   `⏱` = duration of the entire OpenCode task from prompt submission
    until the session becomes idle.

------------------------------------------------------------------------

### Prompt Cache

Displays the prompt cache hit rate for the most recent assistant
request.

Example:

``` text
cache 82%
```

------------------------------------------------------------------------

### Context Window

Displays the current context-window limits from two sources so you can
verify that OpenCode and your local MTPLX server agree on the effective
context size.

Example:

``` text
ctx  OpenCode: 400,000 · MTPLX: 400,000 ✅
```

When the two sources disagree:

``` text
ctx  OpenCode: 400,000 · MTPLX: 200,000 ⚠️
```

When the MTPLX limit has not yet been fetched:

``` text
ctx  OpenCode: 400,000 · MTPLX: ⏬ ❓
```

The context indicator shows:

-   **OpenCode limit** — the context window configured for the active
    model in OpenCode's provider settings (`provider.models[modelID].limit.context`).
-   **MTPLX limit** — the runtime-resolved context window reported by
    the MTPLX server via its `/health` endpoint. This is polled every
    2 seconds from the same base URL OpenCode already uses for the
    active provider (no additional configuration required).
-   **Agreement status** — ✅ when both limits are known and match,
    ⚠️ when they differ, ❓ when either source is unavailable.

The MTPLX `/health` endpoint is expected to expose the resolved context
window under one of:

-   `memory_plan.context_window_resolved`
-   `context_window_resolved`
-   `memory_plan.context_window`
-   `context_window`
-   `resolved_context_window`

If none of these fields are present, the MTPLX value remains
unavailable and only the OpenCode limit is shown.

The `context` indicator is opt-in — add `"context"` to the `show`
array in your `tui.json` to enable it.

This is useful for confirming that MTPLX is honouring the correct
context budget before you encounter truncation or unexpected costs.

### Todo Progress

Displays the current OpenCode Todo progress.

Example:

``` text
todo 2/5
```

This means 2 of 5 non-cancelled Todo items have been completed.

The indicator is hidden when there are no active Todo items.

------------------------------------------------------------------------

### Pending Requests

Displays pending permission and question requests.

Example:

``` text
pending 1
```

The indicator is hidden when there are no pending requests.

------------------------------------------------------------------------

## Example

A fully populated status bar might look like:

``` text
ctx  OpenCode: 400,000 · MTPLX: 400,000 ✅
↩︎ 19:00 · ⏱ 6m08s · ⚡ 106.3 tok/s · decode 142.7 tok/s · $0.1234 · ttft 0.42s · 8.3s · cache 82% · todo 2/5 · pending 1
```

The exact indicators shown depend on the current session state.

------------------------------------------------------------------------

# Installation

## 1. Copy the plugin

Place `status-bar.tsx` in your OpenCode plugin directory.

For example:

``` text
~/.config/opencode/plugins/status-bar.tsx
```

Or keep it in a subdirectory:

``` text
~/.config/opencode/plugins/status-bar/status-bar.tsx
```

------------------------------------------------------------------------

## 2. Configure the plugin

Add the plugin to your OpenCode configuration.Register it in
\~/.config/opencode/tui.json , if u don't have this file, just create
one. TUI plugins are not auto-discovered --- they must be listed here:

Example:

``` json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [["./plugins/status-bar/status-bar.tsx", { "show": ["context", "elapsed", "tps", "decode", "ttft", "dur", "cache", "todo", "pending"] }]]
}
```

Adjust the plugin path to match your local installation.

------------------------------------------------------------------------

## 3. Development with a symbolic link

If you keep the plugin in a Git repository, you do not need to copy the
plugin into the OpenCode configuration directory every time you make a
change.

For example, if your source repository is:

``` text
~/Documents/github/opencode-status-bar
```

create a symbolic link:

``` bash
ln -s ~/Documents/github/opencode-status-bar ~/.config/opencode/plugins/opencode-status-bar
```

If `~/.config/opencode/plugins/opencode-status-bar` already exists as a
copied directory, remove or rename that copy first.

You can verify the symbolic link with:

``` bash
ls -l ~/.config/opencode/plugins/
```

You should see:

``` text
opencode-status-bar -> /Users/lynx/Documents/github/opencode-status-bar
```

After this, edit the plugin directly in the Git repository. OpenCode
will use the files through the symbolic link, so you no longer need to
copy the plugin after every change.

# Configuration

The `show` option controls which indicators are displayed and their
order.

Available indicators:

``` text
context
elapsed
tps
decode
cost
ttft
dur
cache
todo
pending
```

`context` is not enabled by default. Add it to the `show` array to
display the context-window line.

For example:

``` json
{
  "show": [
    "elapsed",
    "tps",
    "decode",
    "cache",
    "todo"
  ]
}
```

will display only:

``` text
⏱ 5m05s · ⚡ 106.3 tok/s · decode 142.7 tok/s · cache 82% · todo 2/5
```

The order in the `show` array determines the order in the status bar.

------------------------------------------------------------------------

## Spacing Options

The plugin also supports spacing options:

``` json
{
  "marginTop": 0,
  "marginBottom": 0,
  "paddingTop": 0,
  "paddingBottom": 0,
  "paddingLeft": 3,
  "paddingRight": 2
}
```

All spacing options are optional.

`marginTop` can be negative if you need to compensate for additional
spacing from the OpenCode TUI layout.

------------------------------------------------------------------------

# Development

This plugin is written in TypeScript/TSX and uses the OpenCode TUI
plugin API.

The implementation uses:

-   OpenCode TUI plugin API
-   OpenTUI Solid JSX
-   Solid signals for reactive state
-   OpenCode session events
-   OpenCode message state

The plugin registers the `app_bottom` TUI slot:

``` text
api.slots.register(...)
```

The status bar is therefore rendered as part of the OpenCode TUI rather
than modifying OpenCode itself.

For the context-window indicator, the plugin also polls the active
provider's `/health` endpoint every 2 seconds (derived from the same
base URL OpenCode already uses, with the trailing `/v1` stripped) to
read the MTPLX runtime-resolved context limit. This requires no
separate MTPLX URL in `tui.json`.

------------------------------------------------------------------------

# Important Events

The stopwatch relies on OpenCode TUI/session events.

### Prompt submission

The stopwatch starts when:

``` text
tui.command.execute
```

is emitted with:

``` text
command = prompt.submit
```

### Session becomes busy

The plugin also handles:

``` text
session.status
```

with:

``` text
status.type = busy
```

as a compatibility/fallback mechanism.

### Session becomes idle

The stopwatch stops when:

``` text
session.status
```

reports:

``` text
status.type = idle
```

A `session.idle` event is also handled as a fallback.

------------------------------------------------------------------------

# Why the Stopwatch Is Different from `dur`

The plugin intentionally tracks two different kinds of time.

### Task elapsed time

``` text
⏱ 6m08s
```

This measures:

``` text
Prompt submitted
        ↓
Reasoning
        ↓
Tool calls
        ↓
MCP calls
        ↓
Additional assistant messages
        ↓
More tool calls
        ↓
Session becomes idle
```

### Assistant message duration

``` text
8.3s
```

This measures the wall-clock duration of an individual completed
assistant message.

Therefore, these numbers are not expected to be the same.

------------------------------------------------------------------------

# Provider Compatibility

The plugin does not contain model-specific logic.

It reads information from OpenCode's session and assistant message
state, so it can be used with different providers and models supported
by OpenCode.

For example, it can be used with:

-   Cloud models
-   OpenAI-compatible providers
-   Local models
-   Local OpenAI-compatible servers
-   Other providers supported by OpenCode

The plugin does not need to know which model is generating the response.

------------------------------------------------------------------------

# Troubleshooting

## The status bar does not appear

Check that the plugin is correctly registered in your OpenCode
configuration.

Also verify that the plugin path is correct.

Restart OpenCode after changing the plugin configuration.

------------------------------------------------------------------------

## The stopwatch stays at zero

Make sure the plugin is running in the OpenCode TUI and that the
`prompt.submit` command event is being received.

The stopwatch uses reactive Solid state, so the displayed value must be
read from a reactive signal rather than from a normal string captured
when the slot is created.

------------------------------------------------------------------------

## Only some indicators appear

Some indicators are conditional.

For example:

``` text
todo
```

is hidden when there are no active Todo items.

Likewise:

``` text
pending
```

is hidden when there are no pending permission/question requests.

Cost and some performance indicators may also be unavailable when
OpenCode has not provided the required session/message data.
