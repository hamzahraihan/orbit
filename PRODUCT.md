# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are software developers running autonomous or interactive coding agents inside the [herdr](https://github.com/herdrdev/herdr) terminal multiplexer on their own workstations or remote servers.

Their situation:
- Often stepped away from their desk (couch, commute, walking, phone in hand) or multi-tasking across multiple workspaces.
- Need to keep long-running agent tasks moving without sitting in front of a desktop terminal all day.
- Need to read what the agent proposed, approve or deny permissions and tool actions, answer prompt questions, dictate clarifications, and occasionally drop directly into the raw terminal session to inspect logs or run commands.
- May also be reading someone else's PC: a second machine joins over SSH from the sidebar, so a phone can steer agents running on a Linux box across the house.

## Product Purpose

Orbit (Orchestrated Remote Background Integration Terminal) exists to provide a local-first, private browser and phone client for herdr. It bridges desktop AI coding workflows to mobile and browser environments so developers can monitor and guide running agents as a structured chat transcript, while keeping the full live terminal immediately accessible.

Success means:
- Zero friction approving an agent question, answering a prompt, or sending a follow-up from a phone.
- High trust: no telemetry, no cloud relays, no leaked credentials or session data.
- Absolute fidelity to herdr: no desynchronization between desktop terminal multiplexer and browser/phone views.

## Positioning

Orbit is an uncompromised, local-first bridge for herdr with phone-first companion ergonomics. Unlike hosted SaaS relays, third-party agent platforms, or generic web terminal mirrors:
- **Private & Telemetry-Free:** A modified fork of `herdr-web-ui` with analytics, telemetry, usage meters, license checks and hosted relay services removed, and nothing added in their place.
- **Native Session Introspection:** Rather than treating terminal output as raw text streams, Orbit natively parses and renders agent session stores (Claude Code, Codex, omp, omo, gjc, pi, OpenCode, Devin, Grok, Hermes and Antigravity) into conversational chat turns, structured interactive approval cards, and file previews — and where a store cannot be read, the terminal still carries the session.
- **Unopinionated Bridge Purity:** Herdr remains the sole authority for ptys, processes, worktrees, and scrollback. Orbit never attempts takeover, never alters herdr's focus unprompted, and never invents competing client-side abstractions.

## Operating Context

- **Host Environments:** A developer machine running Linux (x64, arm64) or macOS, or a Windows x64 PC. The server needs herdr 0.9.0+, Bun 1.4+, and Node 18+ (Node runs the pty sidecar; it is not needed on Windows, which has no sidecar).
- **Windows terminals are mirrors:** herdr cannot attach a terminal there, so the pane is drawn from `pane.read` with typing and a fixed grid rather than a live pty. The rest of the app — chat, alerts, prompts, files — is unaffected.
- **Version floor vs. verified behavior:** 0.9.0 is the install floor, but the bridge's live-verified behavior tracks later releases (`agent_pane_busy` on 0.9.3, `terminal attach`'s outer-terminal handshake on 0.9.4, `events_lost` recovery on 0.9.2+). Older herdr keeps working; specific features degrade rather than break.
- **Network & Access:** Loopback by default. Reached from a phone by Tailscale tailnet (`tailscale serve`), an SSH tunnel, a LAN address, or an HTTPS reverse proxy. PWA install, web push, microphone and secret entry need a secure context (HTTPS or localhost).
- **Client Form Factors:** Installable PWA on iOS (16.4+ for push) and Android phones as the primary companion surface, plus desktop browsers. Each PC installs as its own app, told apart by `HERDR_WEB_APP_NAME`. A device paired to watch only can read but not type.
- **Physical Usage Rituals:** Quick phone glances via push alerts or the top-edge droplet ("checkout-api Needs input"), one-tap prompt approvals, voice dictation while walking, and the on-screen key bar for terminal emergencies.

## Capabilities and Constraints

### Capabilities
- **Chat-First Agent Lens:** Structured conversation view rendering markdown, syntax-highlighted code, diffs, math (KaTeX), diagrams (Mermaid), and interactive approval cards. The chat is read from each agent's own session store; an agent the bridge cannot read still gets its live terminal and status.
- **Agent Roster (11):** `claude`, `codex`, `omp`, `omo`, `gjc`, `pi`, `opencode`, `devin`, `grok`, `hermes`, `agy` (`shared/supported-agents.ts` is the authority). Chat support and prompt-answering differ per agent: Claude, Codex, omp, omo and pi answer from chat; gjc, opencode, devin, grok, hermes and agy are chat-read-only and answer through the terminal. Agy is experimental.
- **On-Demand Live Terminal:** Instant toggle to the xterm.js terminal on the live pane — full-screen TUIs, raw keys, herdr's alternate-screen scrollback, a find overlay, and a viewport shared with every attached client, including the TUI.
- **Prompt Answers from Chat:** Approvals, questions and plan menus become cards; the server checks the menu is still current before answering. Claude additionally offers the `/model` list and task-plan steps.
- **Mobile Touch Key Bar:** Customizable modifier bar (Esc, Tab, Ctrl, Alt, Shift, Enter, arrows, custom macros) preserving terminal focus on touch devices; modifiers latch and combine.
- **Proactive Alerts & Push:** Top-edge in-app droplet and Web Push for agent input, completions and terminal exits, with the wait count in the tab title and the installed app's badge.
- **Voice Dictation:** Server-side transcription (OpenAI-compatible, `gpt-transcribe`, optional text polishing) or the browser's own recognizer, into the composer or the terminal input line.
- **Worktree & Workspace Management:** Creating and navigating workspaces, tabs, splits, and git worktrees from the phone UI; remote PCs join over SSH from the sidebar.
- **File, Diff & Change Viewer:** Native viewer for files, diffs, SVG images and receipts, plus a git Changes list (working tree, staged, or two commits) with unified or split diffs.
- **Send Later:** A scheduled prompt kept on the PC that owns the pane, so it arrives with the browser closed.
- **Plan & Background Tasks:** An agent's recorded todo list and its running background commands/subagents, with the run count in the sidebar.
- **Find Across PCs:** A command palette that searches every connected PC by workspace, branch, pane title, agent kind, or words in a chat.
- **Localized UI:** English, Korean, Japanese and Simplified Chinese, following the browser or chosen in Settings.

### Constraints
- **Bridge Purity:** Never pass `--takeover` to `herdr terminal attach` on Orbit's initiative. Never load `node-pty` in Bun directly.
- **State Sovereignty:** All terminal buffers, pty lifecycle, and agent processes belong strictly to herdr. Orbit stores only UI preferences, local client drafts, and push subscriptions.
- **Single RPC Connection:** One herdr socket connection per RPC call; only `events.subscribe` remains open, and a second subscribe on it is ignored, so reopen it with the full set.
- **Draft Safety:** Nothing typed by the user is ever sent automatically across disconnects; held input waits in an explicit draft until the user sends or discards it. The single exception is a schedule the user set, which is kept on the PC that owns the pane and never types into a box holding a draft.
- **Never Guess a Prompt Answer:** Prompt answers go through `POST /api/pane/prompt/answer`, never inferred digit keys.
- **Zero Cloud Leakage:** No analytics, usage counts, license checks or hosted relay. Session files stay on the PC running each agent. Voice audio goes to the configured transcription provider, and push delivery uses the configured push service — those are the only outbound paths, and both are opt-in.
- **Read-Only Toward the Repo:** Diff and change views never write; a remote PC's repository is read on that PC.

## Brand Commitments

- **Name:** Orbit.
- **Visual Identity:** Quiet Slate: a near-black plum ground (dark) or rose-tinted paper (light), flat panels, one muted rose accent, and chat-app calm that keeps terminal density intact.
- **Resting Calm:** Resting screens are calm and spare. Destructive actions stay neutral until confirmed; danger colors appear only at the moment of risk.
- **Single Chrome Accent:** Muted rose is the single chrome accent (focus, chosen lens, cursor, the chosen row, primary action). Agent statuses use distinct semantic tokens (idle, working, blocked, done) and never rose. Rose marks the live edge alone.
- **Voice & Copy:** Direct, terse, and functional. Messages state only what the user needs right now ("Couldn't attach [Try again]"), never generic uninformative banners.

## Evidence on Hand

- Shipped repository source code across `src/` (React 19 frontend), `server/` (Bun bridge & Node sidecar), and `shared/` (shared wire protocol).
- Documented design tokens, palette values, and themes in `DESIGN.md` and `src/styles.css`.
- Comprehensive automated regression suites (`bun test`, `bun run test:unit`, `bun run test:ui`), plus committed stills in `docs/media/` and `docs/screenshots/`.
- User documentation and visual guides in `docs/` and `README.md` (translated into zh-CN, ja and ko).
- **A modified fork, not an original.** Orbit is a fork of `herdr-web-ui`, MIT-licensed; `NOTICE` records the removals — anonymous usage counts, app update checks, subscription usage meters, the Portal relay, and the original author's remote-PC runtime bundle. The product truth is the fork's, and marketing copy must not claim work upstream did.

## Product Principles

1. **Phone-First Companion:** Every agent interaction—approving a permission, reviewing a diff, dictating a prompt, or toggling into a terminal—must feel native, immediate, and effortless with one thumb on a phone screen.
2. **Chat Clarity, Terminal Truth:** Default to structured, high-signal chat turns and prompt cards, but keep the raw herdr terminal exactly one tap away without state or context loss.
3. **Bridge Purity:** Herdr is the single source of truth. Never compete with, preempt, or abstract over herdr's process management or pty authority.
4. **Calm Resting State:** Inform without screaming. Reserve bright status colors, badges, and alerts strictly for actionable moments (needs input, process exit), keeping idle chrome unobtrusive.
5. **Local-First Privacy:** Developer code and private thought stay on the developer's machine. No analytics, no usage counts, no license checks, no account service. The only outbound paths are the ones the user configures on purpose — a transcription provider for voice, a push service for alerts — and each is off until set.

## Accessibility & Inclusion

- WCAG 2.2 AA conformance across all light and dark theme palettes.
- Minimum 44px (`--touch-target`) hit areas for touch controls on coarse pointer devices.
- Persistent live regions (`role="status"`, `role="alert"`) with announced text hooks for dynamic state changes.
- Full keyboard operability (Mod+Shift shortcuts, arrow navigation in lists and palettes) without trapping or interfering with terminal input.
- Respect for `prefers-reduced-motion` across all transitions, drawers, sheets, and notification droplets (sidebar RUN dot maintains opacity-only breath).
- **Localization:** English, Korean, Japanese and Simplified Chinese (`src/lib/i18n.{ja,ko,zh}.ts`). The UI follows the browser, overridable in Settings. Voice dictation has its own language choice so a Korean or Japanese speaker dictating mixed code terms is transcribed correctly.
