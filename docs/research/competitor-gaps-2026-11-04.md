# Competitor gap research — 2026-11-04

## Scope & method

Competitor definition (user): a herdr plugin or any app that provides
"Read and answer Claude Code, Codex and every other agent on your computer
from your phone, desktop or any browser, as a chat or in the live terminal."

Method: primary sources only — each peer's repo README (raw GitHub),
Orbit's own `PRODUCT.md`, `README.md`, `docs/guide.md`,
`docs/chat-mode-audit.md`, `herdr-plugin.toml`. No secondary blogs.
Every factual claim below cites a URL or a local `file:line`.

### Confirmed peers (make the table)

| Peer | What it is (primary source) | Source |
|---|---|---|
| **collie** (ColliePWA, AltanS) | Self-hosted PWA mobile client for Herdr (primary), tmux/zellij experimental: "driving terminal AI agents such as Claude Code, Codex and OpenCode from your phone… served over Tailscale by default" | https://raw.githubusercontent.com/AltanS/collie/main/README.md |
| **ovis** (devswha) | "formerly herdr web UI", MIT: "shows the coding agents on your computer as chats you answer with a click or a tap, in any browser, the Mac app or your phone. A client for herdr" | https://raw.githubusercontent.com/devswha/ovis/main/README.md |
| **chatmux** (devswha) | AGPL-3.0, tmux-based: "One interface for Claude Code, Codex, OpenCode, and more — already running in your tmux… shows every session in one browser page, from your desktop or your phone" | https://raw.githubusercontent.com/devswha/chatmux/main/README.md |
| **Paseo** (getpaseo) | Apache-2.0 agentic dev environment: "One interface for Claude Code, Codex, Copilot, OpenCode, Pi, Antigravity, and Muse Code agents… desktop, mobile, web, and CLI" | https://raw.githubusercontent.com/getpaseo/paseo/main/README.md |
| **Happy** (slopus) | MIT: "End-to-end encrypted mobile app… The same sessions are already on your phone"; CLI wraps Claude Code/Codex, continue from phone | https://raw.githubusercontent.com/slopus/happy/main/README.md |
| **VibeTunnel** (amantus-ai) | MIT: "Turn any browser into your terminal & command your agents on the go… Perfect for monitoring Claude Code, ChatGPT, or any terminal-based AI tools" | https://raw.githubusercontent.com/amantus-ai/vibetunnel/main/README.md |
| **CC Pocket** (K9i-0) | MIT Flutter app: "Mobile client for Codex and Claude — control coding agents from your phone via WebSocket bridge… Chat first… Markdown, voice input, and image attachments" | https://raw.githubusercontent.com/k9i-0/ccpocket/main/README.md |
| **agent-deck** (asheshgoplani) | MIT TUI + web UI (`agent-deck web` on `127.0.0.1:8420`) + Telegram/Slack "conductor" orchestration for Claude, Gemini, OpenCode, Codex, Pi | https://raw.githubusercontent.com/asheshgoplani/agent-deck/main/README.md |

Ovis is the upstream Orbit was forked/detached from; collie is the closest
functional rival (herdr-first, phone-first, Tailscale-only).

### Rejected / out of table

- **Claude Squad** (smtg-ai/claude-squad) — confirmed via search result:
  "Manage multiple AI terminal agents like Claude Code, Codex, OpenCode, and
  Amp… tmux to create isolated terminal sessions… git worktrees… A simple TUI
  interface" (https://github.com/smtg-ai/claude-squad). TUI-first, no
  phone/browser chat surface → outside the definition. Its worktree/auto-accept
  ideas are noted below only as behavior, not copied (AGPL-3.0).
- **ttyd** (tsl0922/ttyd) — "Share your terminal over the web"
  (https://github.com/tsl0922/ttyd): a generic single-command web terminal,
  no agent awareness, chat, or approvals → terminal trivia, rejected.
- **Wet** — no primary source identified under this name matching the
  definition in this pass; not included (unverified, not guessed).
- herdr itself / herdr-plugin.toml conventions: Orbit is a plugin per
  `herdr-plugin.toml:1-6` (`id = "hamzahraihan.orbit"`,
  `min_herdr_version = "0.9.0"`, actions/startup/panes at
  `herdr-plugin.toml:33-110`). The `herdrdev/herdr` README fetch 404'd in
  this pass, so no claims are made from it here.

## Orbit today (verified baseline)

- Purpose: "local-first, private browser and phone client for herdr…
  monitor and guide running agents as a structured chat transcript, while
  keeping the full live terminal immediately accessible"
  (`PRODUCT.md:20-25`).
- Capabilities: chat-first lens (markdown, code, diffs, KaTeX, Mermaid,
  approval cards), live terminal toggle, mobile key bar, Web Push alerts,
  voice dictation, worktree/workspace management, file & diff viewer
  (`PRODUCT.md:44-50`; also `README.md:80-85`).
- Agents with native chat: Claude Code, Codex, omp, omo, gjc, pi, OpenCode 2,
  Devin CLI, Grok, Hermes, Antigravity (agy) — terminal fallback otherwise
  (`docs/guide.md:150-165`).
- Voice: hold-to-talk, OpenAI `gpt-transcribe` with own key or browser
  SpeechRecognition (`docs/guide.md:234-244`).
- Remote access: Tailscale Serve / SSH tunnel / LAN pairing (6-digit) /
  `HERDR_WEB_TOKEN`; remote PCs via SSH bundle
  (`docs/guide.md:246-296`, `docs/guide.md:298-309`,
  `docs/guide.md:311-328`).
- Constraints: never `--takeover`, never node-pty in Bun, single RPC per
  call, draft safety (nothing auto-sent after disconnect), zero telemetry /
  cloud relays (`PRODUCT.md:52-57`).

## Feature comparison table

| Feature | Peers that have it (cited) | Orbit today (cited) | Verdict |
|---|---|---|---|
| Chat transcript rendering (markdown/code/diffs/math/diagrams) | chatmux: recognized transcripts as conversations + real TUI tab (chatmux README); Paseo, Happy chat rooms; CC Pocket "Chat first… Markdown" | Native Claude/Codex/omp/omo/pi/etc. transcripts + KaTeX + Mermaid (`PRODUCT.md:44`, `docs/guide.md:150-165`) | **Parity** |
| Approval / prompt cards | collie: "Tap to answer an `AskUserQuestion` prompt"; ovis: "Prompts as cards. Checked as still current"; CC Pocket: approvals/questions per session | Approval/question/plan cards checked current before send (`docs/guide.md:211`) | **Parity** |
| Live terminal toggle | chatmux "CLI output" tab; VibeTunnel core product; collie keys board; Paseo terminals in split panes | xterm.js live pane one click from chat (`PRODUCT.md:45`, `docs/guide.md:208`) | **Parity** |
| Mobile UX (key bar, gestures) | collie: configurable keys board, sticky Ctrl/Alt/Shift, presets; chatmux: key bar; CC Pocket: phone-first Flutter app | Customizable key bar + touch selectors (`PRODUCT.md:46`, `docs/guide.md:271-290`) | **Parity** |
| Push notifications | collie: push when agent blocks; ovis: push even with app closed; Happy: push server via APNs/FCM | Web Push + droplet alerts (`PRODUCT.md:47`, `docs/guide.md:213-214`) | **Parity** |
| Voice dictation | collie: built-in voice input (disabled until configured, Whistle STT vendored) + system dictation; Paseo: voice control; CC Pocket: voice input | Hold-to-talk, Whisper/`gpt-transcribe` or browser SR (`docs/guide.md:234-244`) | **Parity** |
| File & diff viewer | collie: Files screen + Changes diffs read-only; Paseo: edit files, review diffs; CC Pocket: browse files, inspect diffs, stage/commit/push | Viewer + Changes (Working tree/Staged/Commits, Unified/Split, Comment-to-agent) read-only (`docs/guide.md:215-216`) | **Parity gap** (commit/push) |
| Worktree / workspace mgmt | chatmux full-access launch option; agent-deck worktree create/finish/cleanup + sparse checkout; Paseo worktree launch; claude-squad tmux+worktrees | New worktree/workspace/branch from phone ⋯ menu, delete checkout (`docs/guide.md:300`) | **Parity** |
| Multi-machine / remote | chatmux: hub + 9 peers (10 PCs), pairing codes; collie: crews multi-machine + failover; Paseo: remote daemons; agent-deck: remotes over SSH | Remote PCs over SSH with bundle (`docs/guide.md:298-309`) | **Parity gap** (no crew failover/single URL) |
| Auth / pairing | collie: per-device token always on; chatmux: Tailscale identity / LAN password / allowlists; Happy: E2EE pair | Tailscale login / 6-digit pair / token (`docs/guide.md:311-328`) | **Parity** |
| PWA / installable | collie: PWA, no app store; chatmux: installable PWA over Tailscale/LAN; CC Pocket *store app* instead; Paseo/Happy *store apps* instead | Installable PWA, no store (`docs/guide.md:246-269`) | **Parity** (PWA bet, see P1) |
| Native iOS/Android/desktop apps | Paseo: "mobile app is the full app, native on iOS and Android" + Electron desktop; Happy: App Store / Play + desktop app; CC Pocket: App Store/Play/macOS dmg; ovis: Mac app + TestFlight/Play beta | PWA only, no native/desktop app (`README.md:24` PWA badge) | **Crucial missing (P1)** |
| Session history / search | collie: "full conversation history beyond standard terminal scrollback" + output search; agent-deck: fuzzy + Recall search across every conversation + cost dashboard; Orbit: Messages search across PCs | Cross-PC message search (Mod+Shift+M, 20 pages/chat) (`docs/guide.md:210`) | **Parity** |
| Agent launching | chatmux: launch from ChatMux with per-session full-access; agent-deck: launch with account/model, Docker sandbox, MCP/skills attach; Paseo: `paseo run --provider … --worktree …` | New workspace picks agent + folder (`docs/guide.md:217`) | **Parity gap** (no permission-mode/model pick) |
| Fork / archive / lifecycle | agent-deck: fork (f/F), archive ^, delete-undo; chatmux: launch full-access badge | No fork/archive (`docs/guide.md:217` lists only create/switch/rename) | **Crucial missing (P2)** |
| Cost / usage visibility | agent-deck: Cost Dashboard (`$`), context-window inspector; Happy/OpenHands-style token metering exists in field | Context ring (token %) only (`docs/guide.md:192`) | **Crucial missing (P2)** |
| Inter-agent messaging / conductor | collie: walky-talky messages between sessions with receipts + durable agents; agent-deck: conductor supervises fleet, escalates to Telegram/Slack; Paseo: built-in orchestration, agents launch other agents | Human→agent only; no agent→agent, no conductor (`docs/guide.md:202-232`) | **Crucial missing (P1)** |
| E2EE cloud relay (no Tailscale) | Paseo: hosted E2EE relay opt-in; Happy: relay server for encrypted sync; ovis: optional Ovis relay ("sees which phone connects… can't read"); VibeTunnel: ngrok/Cloudflare/Pinggy tunnels | Explicitly none — Tailscale/SSH/LAN only (`PRODUCT.md:57`, `docs/guide.md:327` "Never funnel") | **Not recommended** (see below) |
| Session recording / playback | VibeTunnel: asciinema recording of all sessions | None | **Not relevant** (bridge purity) |
| Editor / PR / browser integration | Paseo: editor, diffs, PRs, browser in one window | Deliberately bridge-only; herdr owns ptys (`PRODUCT.md:32`) | **Not relevant** |
| Media generation | CC Pocket: Codex Imagegen in chat | N/A | **Not relevant** |

## Crucial missing features (ranked)

**P1 — Native mobile + desktop apps (store / TestFlight / Play / dmg).**
Paseo, Happy, CC Pocket and ovis all ship native clients; Orbit is PWA-only
(`README.md:24`). PWA push and key-bar work, but store presence is the peers'
proven distribution and reliability path. Fit: phone-first purpose
(`PRODUCT.md:76`). Effort: large; not a prerequisite for the other gaps.

**P1 — Agent-to-agent orchestration (conductor / walky-talky).**
Collie (walky-talky with receipts, crews), agent-deck (conductor + Telegram
escalation), and Paseo (agents launch agents) all let agents supervise each
other. Orbit today is strictly human→agent (`docs/guide.md:202-232`). Fit:
long-running agents on a phone need an on-box supervisor, not a human watching
every pane. Must be herdr-owned (bridge purity): Orbit would expose a
herdr-native primitive, never a shadow orchestrator.

**P2 — Session lifecycle: fork, archive, per-launch permission modes.**
Agent-deck (fork/archive), chatmux (per-session full-access launch with
warning badge), claude-squad (auto-accept). Orbit creates worktrees but has
no fork, no archive, no launch-time permission-mode picker
(`docs/guide.md:217`). Fit: phone users spawn experimental branches and need
cheap rollback; full-access must stay explicit and badged, never silent.

**P2 — Cost/context visibility beyond the ring.**
Agent-deck's Cost Dashboard (`$`) and context inspector have no Orbit
equivalent; Orbit shows only a context-fill ring (`docs/guide.md:192`).
Fit: phone-first monitoring of long autonomous runs. Must stay local-first —
no telemetry pipeline, per `PRODUCT.md:57`.

## Explicitly not recommended

- **Cloud relays / tunnels** (Paseo relay, Happy relay server, ovis relay,
  VibeTunnel ngrok/Cloudflare): Orbit's zero-relay stance is the product
  (`PRODUCT.md:29-30,57`). A relay sees metadata at minimum (ovis itself
  discloses: "sees which phone connects to which PC… can't read").
- **Telemetry / usage meters / subscription checks**: removed in Orbit's
  fork by design (`README.md:37`); peers' anonymous counts (ovis) are a
  regression, not a gap.
- **PTY takeover**: `PRODUCT.md:53` forbids `--takeover` on Orbit's
  initiative; peers that attach/take over terminals violate bridge purity,
  though Orbit already exposes a user-initiated attach escape hatch in
  `docs/guide.md:415-418`.
- **Copying peer code**: chatmux is AGPL-3.0, claude-squad AGPL-3.0, Paseo
  Apache-2.0, Happy/collie/ovis/VibeTunnel/CC Pocket/agent-deck MIT — but
  per `docs/chat-mode-audit.md:5-7`, behavior only, no implementation copying.
- **Generic terminal features** (ttyd-style sharing, recording): outside the
  agent-remote use case and against "chat clarity, terminal truth"
  (`PRODUCT.md:77`).

## Sources checked (primary)

- Local: `PRODUCT.md`, `README.md:1-100`, `docs/guide.md`,
  `docs/chat-mode-audit.md`, `herdr-plugin.toml`
- https://raw.githubusercontent.com/AltanS/collie/main/README.md
- https://raw.githubusercontent.com/devswha/ovis/main/README.md
- https://raw.githubusercontent.com/devswha/chatmux/main/README.md
- https://raw.githubusercontent.com/getpaseo/paseo/main/README.md
- https://raw.githubusercontent.com/slopus/happy/main/README.md
- https://raw.githubusercontent.com/amantus-ai/vibetunnel/main/README.md
- https://raw.githubusercontent.com/k9i-0/ccpocket/main/README.md
- https://raw.githubusercontent.com/asheshgoplani/agent-deck/main/README.md
- https://github.com/smtg-ai/claude-squad (search-indexed README excerpt)
- https://github.com/tsl0922/ttyd (search-indexed README excerpt)
