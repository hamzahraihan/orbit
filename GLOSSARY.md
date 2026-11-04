# Orbit

Local-first browser/phone bridge for the herdr terminal multiplexer. herdr owns every pty, scrollback and agent state; Orbit only mirrors and controls them. Terms below are Orbit-specific.

## Language

**Bridge**:
Orbit's role: mirror herdr's state to browser/phone and send back control. It never owns ptys, processes, or scrollback.
_Avoid_: proxy, relay, host, sync engine

**Agent**:
A coding agent session (Claude Code, Codex, omp, omo, pi, Hermes, Devin CLI) running inside a herdr pane. Orbit renders its transcript and cards; herdr runs it.
_Avoid_: bot, assistant, session (for the agent process itself)

**Orchestration**:
One agent causing another agent to start, by launching it through herdr (worktree/tab + agent.start). Orbit implements the launch; herdr owns the new pty.
_Avoid_: multi-agent, federation, swarm

**Walky-talky**:
Agents talking to each other to hand off work (peer pattern from collie). Deliberately NOT Orbit's model — see ADR-0001.
_Avoid_: handoff, chat-between-agents

**Conductor**:
A router that assigns work between agents (agent-deck pattern). Deliberately NOT Orbit's model — see ADR-0001.
_Avoid_: scheduler, dispatcher, orchestrator

**Fork**:
Duplicating a session to continue it (agent-deck F/fork). Distinct from creating a worktree: fork copies state, worktree checks out a branch.
_Avoid_: clone, branch, worktree

**Worktree**:
A git worktree + herdr tab created via `worktree.create`; one branch per worktree. Orbit's only existing spawn primitive.
_Avoid_: checkout, fork

**Crucial (gap)**:
A missing capability that blocks the job in PRODUCT.md — keeping long-running agent tasks moving without sitting at a desktop. Peer presence is supporting evidence, not the definition.
_Avoid_: nice-to-have, feature request
