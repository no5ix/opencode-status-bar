/** @jsxImportSource @opentui/solid */

import {
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js"

import type {
  TuiPlugin,
  TuiPluginModule,
  TuiSlotPlugin,
} from "@opencode-ai/plugin/tui"

type Stat = {
  tps: number
  tokens: number
  ms?: number
  cost?: number
  ttft?: number
  live: boolean
}

const DEFAULT_SHOW = [
  "context",
  "tps",
  "decode",
  "cost",
  "ttft",
  "dur",
  "cache",
  "todo",
  "pending",
]

const SEP = " · "

const usd = (c: number) =>
  c >= 1 ? `$${c.toFixed(2)}` : `$${c.toFixed(4)}`

const num = (v: unknown, d: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : d

const formatTokenCount = (value: number): string =>
  Math.max(0, Math.round(value)).toLocaleString("en-US")

const contextBarParts = (percent: number, width = 16) => {
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.round((clamped / 100) * width)

  return {
    filled: "█".repeat(filled),
    empty: "░".repeat(width - filled),
  }
}

// -----------------------------------------------------------------------------
// Stopwatch formatting
// -----------------------------------------------------------------------------

const formatPromptTimestamp = (date: Date = new Date()): string =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`

const formatElapsed = (ms: number): string => {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000)

  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h${String(minutes).padStart(2, "0")}m${String(seconds).padStart(2, "0")}s`
  }

  if (minutes > 0) {
    return `${minutes}m${String(seconds).padStart(2, "0")}s`
  }

  return `${seconds}s`
}

// -----------------------------------------------------------------------------
// Reactive status bar
// -----------------------------------------------------------------------------

function StatusBarView(props: {
  api: any
  sessionID: () => string | undefined

  // IMPORTANT:
  // This is a Solid signal getter.
  // When message statistics change, the component rerenders.
  stats: () => Record<string, Stat>

  // Current-prompt stopwatch.
  elapsedMs: () => number

  // Timestamp of the most recent prompt submission.
  promptTimestamp: () => string | null

  show: string[]

  paddingLeft: number
  paddingRight: number
  paddingTop: number
  paddingBottom: number
  marginTop: number
  marginBottom: number
}) {
  // ---------------------------------------------------------------------------
  // Reactive current statistics
  // ---------------------------------------------------------------------------

  const currentStat = createMemo(() => {
    const sessionID = props.sessionID()

    if (!sessionID) {
      return undefined
    }

    return props.stats()[sessionID]
  })

  // ---------------------------------------------------------------------------
  // Reactive existing indicators
  // ---------------------------------------------------------------------------

  const existingSegments = createMemo(() => {
    const sessionID = props.sessionID()

    if (!sessionID) {
      return ""
    }

    const s = currentStat()

    const messages =
      props.api.state.session.messages(sessionID) ?? []

    // -------------------------------------------------------------------------
    // Cost
    // -------------------------------------------------------------------------

    let cost = 0
    let last: any

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]

      if (message.role !== "assistant") {
        continue
      }

      if (!last) {
        last = message
      }

      if (typeof message.cost === "number") {
        cost += message.cost
      }
    }

    // -------------------------------------------------------------------------
    // Cache
    // -------------------------------------------------------------------------

    const cacheRead =
      last?.tokens?.cache?.read ?? 0

    const cacheInput =
      last?.tokens?.input ?? 0

    const cacheRate =
      cacheRead + cacheInput > 0
        ? cacheRead / (cacheRead + cacheInput)
        : undefined

    // -------------------------------------------------------------------------
    // Todo
    // -------------------------------------------------------------------------

    const todos =
      props.api.state.session.todo(sessionID) ?? []

    let done = 0
    let total = 0

    for (const todo of todos) {
      if (todo.status === "cancelled") {
        continue
      }

      total++

      if (todo.status === "completed") {
        done++
      }
    }

    // -------------------------------------------------------------------------
    // Pending permissions / questions
    // -------------------------------------------------------------------------

    const waiting =
      (props.api.state.session.permission(sessionID)?.length ?? 0) +
      (props.api.state.session.question(sessionID)?.length ?? 0)

    // -------------------------------------------------------------------------
    // All existing indicators
    // -------------------------------------------------------------------------

    const segments: Record<string, string> = {
      tps:
        s && s.tps > 0
          ? `⚡ ${s.tps.toFixed(1)} tok/s`
          : "",

      decode:
        s &&
        !s.live &&
        s.ms &&
        s.ttft !== undefined &&
        s.ms > s.ttft
          ? `decode ${(s.tokens / ((s.ms - s.ttft) / 1000)).toFixed(1)} tok/s`
          : "",

      cost:
        cost > 0
          ? usd(cost)
          : "",

      ttft:
        s &&
        !s.live &&
        s.ttft !== undefined &&
        s.ttft >= 0
          ? `ttft ${(s.ttft / 1000).toFixed(2)}s`
          : "",

      dur:
        s &&
        !s.live &&
        s.ms
          ? `${(s.ms / 1000).toFixed(1)}s`
          : "",

      cache:
        cacheRate !== undefined
          ? `cache ${Math.round(cacheRate * 100)}%`
          : "",

      todo:
        total > 0
          ? `todo ${done}/${total}`
          : "",

      pending:
        waiting > 0
          ? `pending ${waiting}`
          : "",
    }

    return props.show
      .map((key) => segments[key])
      .filter(Boolean)
      .join(SEP)
  })

  const contextInfo = createMemo(() => {
    const sessionID = props.sessionID()

    if (!sessionID) {
      return undefined
    }

    const messages =
      props.api.state.session.messages(sessionID) ?? []

    // Match OpenCode's built-in sidebar context calculation.
    const lastAssistant = messages.findLast(
      (message: any) =>
        message.role === "assistant" &&
        message.tokens &&
        (message.tokens.output ?? 0) > 0,
    )

    if (!lastAssistant) {
      return undefined
    }

    const tokens =
      (lastAssistant.tokens.input ?? 0) +
      (lastAssistant.tokens.output ?? 0) +
      (lastAssistant.tokens.reasoning ?? 0) +
      (lastAssistant.tokens.cache?.read ?? 0) +
      (lastAssistant.tokens.cache?.write ?? 0)

    const model = props.api.state.provider
      .find((provider: any) => provider.id === lastAssistant.providerID)
      ?.models?.[lastAssistant.modelID]

    const limit = model?.limit?.context

    if (typeof limit !== "number" || limit <= 0) {
      return undefined
    }

    return {
      tokens,
      limit,
      percent: Math.round((tokens / limit) * 100),
    }
  })

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <box
      visible={props.sessionID() !== undefined}
      width="100%"
      paddingLeft={props.paddingLeft}
      paddingRight={props.paddingRight}
      paddingTop={props.paddingTop}
      paddingBottom={props.paddingBottom}
      marginTop={props.marginTop}
      marginBottom={props.marginBottom}
    >
      {props.show.includes("context") && contextInfo() ? (
        <text>
          {(() => {
            const context = contextInfo()!
            const bar = contextBarParts(context.percent)
            const theme = props.api.theme.current

            return (
              <>
                <span fg={theme.text}>Context </span>
                <span fg={theme.accent}>{bar.filled}</span>
                <span fg={theme.textMuted}>{bar.empty}</span>
                <span fg={theme.textMuted}>{` ${context.percent}% `}</span>
                <span fg={theme.textMuted}>
                  {`${formatTokenCount(context.tokens)} / ${formatTokenCount(context.limit)}`}
                </span>
              </>
            )
          })()}
        </text>
      ) : null}
      <text fg={props.api.theme.current.textMuted}>
        {(() => {
          const timestamp = props.promptTimestamp()

          return timestamp
            ? `↩︎ ${timestamp}${SEP}`
            : ""
        })()}
        {`⏱ ${formatElapsed(props.elapsedMs())}`}
        {(() => {
          const existing = existingSegments()

          return existing
            ? `${SEP}${existing}`
            : ""
        })()}
      </text>
    </box>
  )
}

// -----------------------------------------------------------------------------
// Plugin
// -----------------------------------------------------------------------------

const tui: TuiPlugin = async (api, options) => {
  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  const show = Array.isArray(options?.show)
    ? (options.show as unknown[]).filter(
        (x): x is string => typeof x === "string",
      )
    : DEFAULT_SHOW

  const marginTop = num(options?.marginTop, 0)
  const marginBottom = num(options?.marginBottom, 0)
  const paddingTop = num(options?.paddingTop, 0)
  const paddingBottom = num(options?.paddingBottom, 0)
  const paddingLeft = num(options?.paddingLeft, 3)
  const paddingRight = num(options?.paddingRight, 2)

  // ---------------------------------------------------------------------------
  // CURRENT SESSION
  // ---------------------------------------------------------------------------

  const currentSession = createMemo(() => {
    const route = api.route.current

    if (
      route.name !== "session" ||
      !("params" in route)
    ) {
      return undefined
    }

    const id = route.params?.sessionID

    return typeof id === "string"
      ? id
      : undefined
  })

  // ---------------------------------------------------------------------------
  // REACTIVE MESSAGE STATISTICS
  // ---------------------------------------------------------------------------
  //
  // IMPORTANT:
  //
  // This MUST remain a Solid signal.
  //
  // message.updated -> setStats(...)
  //                  ↓
  // Solid notices the change
  //                  ↓
  // StatusBarView rerenders
  //                  ↓
  // TPS / decode / TTFT / dur update
  //
  // ---------------------------------------------------------------------------

  const [stats, setStats] =
    createSignal<Record<string, Stat>>({})

  const put = (
    sessionID: string,
    stat: Stat,
  ) => {
    setStats((previous) => ({
      ...previous,
      [sessionID]: stat,
    }))
  }

  // ---------------------------------------------------------------------------
  // CURRENT-PROMPT STOPWATCH
  // ---------------------------------------------------------------------------

  const [elapsedMs, setElapsedMs] =
    createSignal(0)

  // Most recent prompt submission time. This remains frozen until the next
  // prompt is submitted.
  const [promptTimestamp, setPromptTimestamp] =
    createSignal<string | null>(null)

  const [startedAt, setStartedAt] =
    createSignal<number | null>(null)

  let stopwatchSessionID:
    | string
    | undefined

  // Update every 100ms while a prompt is running.
  const stopwatchInterval = setInterval(() => {
    const start = startedAt()

    if (start === null) {
      return
    }

    setElapsedMs(
      Date.now() - start,
    )
  }, 100)

  onCleanup(() => {
    clearInterval(stopwatchInterval)
  })

  // ---------------------------------------------------------------------------
  // START STOPWATCH
  // ---------------------------------------------------------------------------

  const startStopwatch = (
    sessionID: string,
  ) => {
    stopwatchSessionID = sessionID

    // New prompt:
    // immediately reset the old stopwatch.
    setElapsedMs(0)

    // Start now.
    setStartedAt(Date.now())
  }

  // ---------------------------------------------------------------------------
  // STOP STOPWATCH
  // ---------------------------------------------------------------------------

  const stopStopwatch = (
    sessionID: string,
  ) => {
    if (
      stopwatchSessionID !== sessionID
    ) {
      return
    }

    const start = startedAt()

    if (start !== null) {
      // Capture final value.
      setElapsedMs(
        Date.now() - start,
      )
    }

    // Stop the stopwatch.
    //
    // elapsedMs is NOT reset, so the final value stays frozen.
    setStartedAt(null)
  }

  // ---------------------------------------------------------------------------
  // PROMPT SUBMITTED
  // ---------------------------------------------------------------------------

  api.event.on(
    "tui.command.execute",
    (event) => {
      if (
        event.properties.command !==
        "prompt.submit"
      ) {
        return
      }

      // Start the stopwatch immediately when Enter submits the prompt.
      // The timestamp itself is recorded from the resulting user message
      // below, which is more reliable across OpenCode TUI builds.

      const sessionID =
        currentSession()

      if (!sessionID) {
        return
      }

      startStopwatch(sessionID)
    },
  )

  // ---------------------------------------------------------------------------
  // SESSION STATUS
  // ---------------------------------------------------------------------------

  api.event.on(
    "session.status",
    (event) => {
      const sessionID =
        event.properties.sessionID

      const status =
        event.properties.status.type

      // Safety fallback:
      // if we somehow missed prompt.submit,
      // busy starts the stopwatch.
      //
      // IMPORTANT:
      // Do NOT restart an already-running stopwatch.
      if (status === "busy") {
        if (
          stopwatchSessionID !== sessionID ||
          startedAt() === null
        ) {
          startStopwatch(sessionID)
        }

        return
      }

      if (status === "idle") {
        stopStopwatch(sessionID)
      }
    },
  )

  // Compatibility fallback.
  api.event.on(
    "session.idle",
    (event) => {
      stopStopwatch(
        event.properties.sessionID,
      )
    },
  )

  // ---------------------------------------------------------------------------
  // EXISTING THROUGHPUT / TTFT TRACKING
  // ---------------------------------------------------------------------------

  const sample =
    new Map<
      string,
      { tokens: number; t: number }
    >()

  const firstPart =
    new Map<string, number>()

  api.event.on(
    "message.part.updated",
    (event) => {
      const part =
        event.properties?.part

      const start =
        part?.time?.start

      if (
        !part?.messageID ||
        typeof start !== "number"
      ) {
        return
      }

      const previous =
        firstPart.get(
          part.messageID,
        )

      if (
        previous === undefined ||
        start < previous
      ) {
        firstPart.set(
          part.messageID,
          start,
        )
      }
    },
  )

  // Last submitted user message whose timestamp we have recorded.
  let lastPromptMessageID: string | undefined

  api.event.on(
    "message.updated",
    (event) => {
      const info =
        event.properties?.info

      if (!info) {
        return
      }

      // A submitted prompt becomes a user message. Use its creation time as
      // the prompt timestamp. Track the message ID so repeated updates to the
      // same user message cannot move the timestamp.
      if (info.role === "user") {
        if (
          info.id !== lastPromptMessageID &&
          typeof info.time?.created === "number"
        ) {
          lastPromptMessageID = info.id
          setPromptTimestamp(
            formatPromptTimestamp(
              new Date(info.time.created),
            ),
          )
        }

        return
      }

      if (info.role !== "assistant") {
        return
      }

      const {
        tokens,
        time,
      } = info

      if (
        !tokens ||
        !time ||
        typeof time.created !==
          "number"
      ) {
        return
      }

      const total =
        (tokens.output ?? 0) +
        (tokens.reasoning ?? 0)

      if (total <= 0) {
        return
      }

      // -----------------------------------------------------------------------
      // Still streaming
      // -----------------------------------------------------------------------

      if (
        typeof time.completed !==
        "number"
      ) {
        const now = Date.now()

        const previous =
          sample.get(info.id)

        sample.set(info.id, {
          tokens: total,
          t: now,
        })

        if (
          !previous ||
          now - previous.t < 200 ||
          total <= previous.tokens
        ) {
          return
        }

        const tps =
          (total - previous.tokens) /
          ((now - previous.t) / 1000)

        if (
          Number.isFinite(tps) &&
          tps > 0
        ) {
          put(
            info.sessionID,
            {
              tps,
              tokens: total,
              live: true,
            },
          )
        }

        return
      }

      // -----------------------------------------------------------------------
      // Completed assistant message
      // -----------------------------------------------------------------------

      const ms =
        time.completed -
        time.created

      const start =
        firstPart.get(info.id)

      firstPart.delete(info.id)
      sample.delete(info.id)

      if (ms <= 0) {
        return
      }

      put(
        info.sessionID,
        {
          tps:
            total /
            (ms / 1000),

          tokens: total,

          ms,

          ttft:
            start !== undefined &&
            start >= time.created
              ? start - time.created
              : undefined,

          cost:
            typeof info.cost ===
            "number"
              ? info.cost
              : undefined,

          live: false,
        },
      )
    },
  )

  // ---------------------------------------------------------------------------
  // BOTTOM SLOT
  // ---------------------------------------------------------------------------

  const slot: TuiSlotPlugin = {
    slots: {
      app_bottom() {
        return (
          <StatusBarView
            api={api}
            sessionID={currentSession}
            stats={stats}
            elapsedMs={elapsedMs}
            promptTimestamp={promptTimestamp}
            show={show}
            paddingLeft={paddingLeft}
            paddingRight={paddingRight}
            paddingTop={paddingTop}
            paddingBottom={paddingBottom}
            marginTop={marginTop}
            marginBottom={marginBottom}
          />
        )
      },
    },
  }

  api.slots.register(slot)
}

// -----------------------------------------------------------------------------
// Export
// -----------------------------------------------------------------------------

const plugin: TuiPluginModule & {
  id: string
} = {
  id: "status-bar",
  tui,
}

export default plugin