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

const formatPromptTimestamp = (date: Date): string =>
  date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })

const extractMtplxContextWindow = (payload: any): number | undefined => {
  if (!payload || typeof payload !== "object") {
    return undefined
  }

  // MTPLX exposes the resolved runtime context window from its memory
  // planner on /health.
  const candidates = [
    payload.memory_plan?.context_window_resolved,
    payload.context_window_resolved,
    payload.memory_plan?.context_window,
    payload.context_window,
    payload.resolved_context_window,
  ]

  for (const value of candidates) {
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      value > 0
    ) {
      return value
    }
  }

  return undefined
}

const providerBaseUrl = (provider: any): string | undefined => {
  const candidates = [
    provider?.options?.baseURL,
    provider?.options?.baseUrl,
    provider?.baseURL,
    provider?.baseUrl,
  ]

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim()
    }
  }

  return undefined
}

const normalizeMtplxBaseUrl = (value: string): string => {
  let url = value.trim().replace(/\/+$/, "")

  // OpenCode OpenAI-compatible providers commonly store the API root as
  // http://127.0.0.1:8000/v1. MTPLX /health lives one level above /v1.
  url = url.replace(/\/v1$/i, "")

  return url
}

const findMtplxBaseUrl = (
  api: any,
  sessionMessages: any[],
): string | undefined => {
  let providerID: string | undefined
  let modelID: string | undefined

  for (let i = sessionMessages.length - 1; i >= 0; i--) {
    const message = sessionMessages[i]

    if (message?.role === "assistant") {
      if (typeof message.providerID === "string") {
        providerID = message.providerID
      }
      if (typeof message.modelID === "string") {
        modelID = message.modelID
      }
      if (providerID && modelID) {
        break
      }
    }

    const selectedModel = message?.model ?? message?.info?.model

    if (selectedModel) {
      if (typeof selectedModel.providerID === "string") {
        providerID = selectedModel.providerID
      }
      if (typeof selectedModel.modelID === "string") {
        modelID = selectedModel.modelID
      }
      if (!modelID && typeof selectedModel.id === "string") {
        modelID = selectedModel.id
      }
    }
  }

  const providers = Array.isArray(api?.state?.provider)
    ? api.state.provider
    : []

  if (providerID) {
    const selectedProvider = providers.find(
      (provider: any) => provider?.id === providerID,
    )

    const url = providerBaseUrl(selectedProvider)

    if (url) {
      return normalizeMtplxBaseUrl(url)
    }
  }

  // If OpenCode's current model/provider identity is unavailable, prefer a
  // provider with a localhost URL. This keeps the feature zero-config for a
  // local MTPLX setup while avoiding a hard-coded MTPLX endpoint.
  for (const provider of providers) {
    const url = providerBaseUrl(provider)

    if (!url) {
      continue
    }

    try {
      const parsed = new URL(url)
      if (
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "localhost" ||
        parsed.hostname === "::1"
      ) {
        return normalizeMtplxBaseUrl(url)
      }
    } catch {
      // Ignore malformed provider URLs.
    }
  }

  return undefined
}

const fetchMtplxContextWindow = async (
  baseUrl: string,
): Promise<number | undefined> => {
  try {
    const response = await fetch(
      `${normalizeMtplxBaseUrl(baseUrl)}/health`,
    )

    if (!response.ok) {
      return undefined
    }

    return extractMtplxContextWindow(await response.json())
  } catch {
    return undefined
  }
}

// -----------------------------------------------------------------------------
// Stopwatch formatting
// -----------------------------------------------------------------------------

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

  // Forces context information to refresh when OpenCode message state changes.
  contextRefreshTick: () => number

  // Resolved MTPLX server-side context window.
  mtplxContextWindow: () => number | undefined

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

  // ---------------------------------------------------------------------------
  // Context window information
  // ---------------------------------------------------------------------------

  const contextInfo = createMemo(() => {
    const sessionID = props.sessionID()

    if (!sessionID) {
      return undefined
    }

    props.contextRefreshTick()

    const messages =
      props.api.state.session.messages(sessionID) ?? []

    // Resolve the OpenCode model context limit immediately from the model
    // selected for this session. This is available before the first MTPLX
    // response arrives.
    let providerID: string | undefined
    let modelID: string | undefined

    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i] as any

      if (message.role === "assistant") {
        if (typeof message.providerID === "string") {
          providerID = message.providerID
        }
        if (typeof message.modelID === "string") {
          modelID = message.modelID
        }
        if (providerID && modelID) {
          break
        }
      }

      const selectedModel =
        message.model ?? message.info?.model

      if (selectedModel) {
        if (typeof selectedModel.providerID === "string") {
          providerID = selectedModel.providerID
        }
        if (typeof selectedModel.modelID === "string") {
          modelID = selectedModel.modelID
        }
        if (!modelID && typeof selectedModel.id === "string") {
          modelID = selectedModel.id
        }
      }
    }

    let openCodeLimit: number | undefined

    if (providerID && modelID) {
      const providers = Array.isArray(props.api.state.provider)
        ? props.api.state.provider
        : []

      const provider = providers.find(
        (item: any) => item?.id === providerID,
      )

      const configuredLimit =
        provider?.models?.[modelID]?.limit?.context

      if (
        typeof configuredLimit === "number" &&
        configuredLimit > 0
      ) {
        openCodeLimit = configuredLimit
      }
    }

    // Fallback to the most recent assistant's model identity.
    if (!openCodeLimit) {
      const lastAssistant = messages.findLast(
        (message: any) =>
          message.role === "assistant" &&
          typeof message.providerID === "string" &&
          typeof message.modelID === "string",
      ) as any

      if (lastAssistant) {
        const providers = Array.isArray(props.api.state.provider)
          ? props.api.state.provider
          : []

        const provider = providers.find(
          (item: any) => item?.id === lastAssistant.providerID,
        )

        const configuredLimit =
          provider?.models?.[lastAssistant.modelID]?.limit?.context

        if (
          typeof configuredLimit === "number" &&
          configuredLimit > 0
        ) {
          openCodeLimit = configuredLimit
        }
      }
    }

    // Use the latest assistant token accounting already known by OpenCode.
    // This lets the effective limit be calculated before the next task ends.
    const lastAssistantWithTokens = messages.findLast(
      (message: any) =>
        message.role === "assistant" &&
        message.tokens,
    ) as any

    const tokens = lastAssistantWithTokens?.tokens
      ? (lastAssistantWithTokens.tokens.input ?? 0) +
        (lastAssistantWithTokens.tokens.output ?? 0) +
        (lastAssistantWithTokens.tokens.reasoning ?? 0) +
        (lastAssistantWithTokens.tokens.cache?.read ?? 0) +
        (lastAssistantWithTokens.tokens.cache?.write ?? 0)
      : 0

    const mtplxLimit = props.mtplxContextWindow()

    // OpenCode is the temporary effective limit until MTPLX reports its
    // runtime-resolved limit. After that, MTPLX becomes the source of truth.
    const effectiveLimit = mtplxLimit ?? openCodeLimit

    const usagePercent =
      effectiveLimit && effectiveLimit > 0
        ? Math.round((tokens / effectiveLimit) * 100)
        : undefined

    return {
      tokens,
      openCodeLimit,
      mtplxLimit,
      effectiveLimit,
      usagePercent,
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
        <text fg={props.api.theme.current.textMuted}>
          {(() => {
            const context = contextInfo()!

            const openCodeText =
              context.openCodeLimit !== undefined
                ? `OpenCode: ${formatTokenCount(context.openCodeLimit)}`
                : "OpenCode: ❓"

            const mtplxText =
              context.mtplxLimit !== undefined
                ? `MTPLX: ${formatTokenCount(context.mtplxLimit)}`
                : "MTPLX: ⏬ ❓"

            let status = "❓"

            if (
              context.openCodeLimit !== undefined &&
              context.mtplxLimit !== undefined
            ) {
              status =
                context.openCodeLimit === context.mtplxLimit
                  ? "✅"
                  : "⚠️"
            }

            return `ctx  ${openCodeText} · ${mtplxText} ${status}`
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
  // REACTIVE CONTEXT / PROMPT DATA
  // ---------------------------------------------------------------------------

  const [promptTimestamp, setPromptTimestamp] =
    createSignal<string | null>(null)

  const [contextRefreshTick, setContextRefreshTick] =
    createSignal(0)

  const [mtplxContextWindow, setMtplxContextWindow] =
    createSignal<number | undefined>(undefined)

  let mtplxPollTimer: ReturnType<typeof setInterval> | undefined

  const pollMtplx = async () => {
    const route = api.route.current

    if (route.name !== "session" || !("params" in route)) {
      setMtplxContextWindow(undefined)
      return
    }

    const sessionID = route.params?.sessionID

    if (typeof sessionID !== "string") {
      setMtplxContextWindow(undefined)
      return
    }

    const messages = api.state.session.messages(sessionID) ?? []
    const baseUrl = findMtplxBaseUrl(api, messages)

    if (!baseUrl) {
      setMtplxContextWindow(undefined)
      return
    }

    setMtplxContextWindow(
      await fetchMtplxContextWindow(baseUrl),
    )
  }

  // Poll the same provider endpoint OpenCode already uses. There is no
  // separate MTPLX URL in tui.json and no hard-coded MTPLX port.
  void pollMtplx()

  mtplxPollTimer = setInterval(() => {
    void pollMtplx()
  }, 2000)

  onCleanup(() => {
    if (mtplxPollTimer) {
      clearInterval(mtplxPollTimer)
    }
  })

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

  api.event.on(
    "message.updated",
    (event) => {
      setContextRefreshTick((value) => value + 1)

      const info =
        event.properties?.info

      if (!info) {
        return
      }

      if (info.role === "user") {
        if (typeof info.time?.created === "number") {
          setPromptTimestamp(
            formatPromptTimestamp(new Date(info.time.created)),
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
            contextRefreshTick={contextRefreshTick}
            mtplxContextWindow={mtplxContextWindow}
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