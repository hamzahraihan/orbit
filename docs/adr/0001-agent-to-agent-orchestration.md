# ADR-0001: Agent-to-agent orchestration is launch-via-herdr, human-triggered

Orbit will implement agent-to-agent orchestration as one agent launching another through herdr's existing primitives (`worktree.create` / `tab.create` + `agent.start`), always triggered by a human from Orbit. Agents will not talk to each other (walky-talky) and no conductor will route work between them.

**Status**: accepted

**Considered Options**:
- Walky-talky (collie): agents message each other to hand off work. Rejected: needs a new message bus and peer trust model; conflicts with bridge purity (herdr owns ptys/processes).
- Conductor (agent-deck): a router assigns work between agents. Rejected: invents an Orbit-side abstraction over herdr's process management.
- Agent self-spawns (running agent launches helpers on its own): rejected for now as a trust/safety change; human-triggered reuses approval cards users already trust. May be revisited separately.
- Launch-via-herdr (chosen): reuses `server/agent-launch.ts` + `workspace-routes.ts` worktree/tab flows and `Sidebar.tsx` → New worktree. Bridge purity holds.

**Consequences**:
- "Crucial" gaps are job-based (PRODUCT.md: keep long-running tasks moving from phone), not peer-count-based.
- Native apps, cloud relays, telemetry, and `--takeover` remain out of scope.
- Proof scenario: phone creates "explore-api" worktree, then spawns "implement-api" from its findings without opening desktop herdr. See `docs/research/competitor-gaps-2026-11-04.md`.
