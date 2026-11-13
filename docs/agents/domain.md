# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the
codebase.

Orbit is a **single-context** repo: one `GLOSSARY.md` and one `docs/adr/` at the root. There is no
`GLOSSARY-MAP.md` and no per-context glossary.

## Before exploring, read these

- **`AGENTS.md`** at the repo root: the traps the code and tests do not show (bridge invariants,
  test rules, maintainer workflow). **`server/AGENTS.md`** and **`src/AGENTS.md`** hold the
  server-side and client-side halves. Read the scoped file when you touch that area.
- **`GLOSSARY.md`** at the repo root: Orbit's vocabulary, with the synonyms to avoid.
- **`docs/adr/`**: read the ADRs that touch the area you're about to work in.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest
creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and
`/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

Single-context repo (this repo):

```
/
├── AGENTS.md
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-agent-to-agent-orchestration.md
│   └── 0002-<slug>.md
├── server/
│   └── AGENTS.md
└── src/
    └── AGENTS.md
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a
test name), use the term as defined in `GLOSSARY.md`. Don't drift to synonyms the glossary explicitly
avoids.

`GLOSSARY.md` gives each term a definition and an `_Avoid_:` line listing the words the project
rejects for it (for example, **Bridge** is not a proxy or a relay; **Orchestration** is not a
swarm). Those avoided words are a deliberate naming decision, not a synonym list: using one is a
sign the term is being misused.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language
the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

To add a term, follow the existing shape:

```markdown
**Term**:
Definition in one or two sentences.
_Avoid_: synonym, synonym
```

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0001 (agent-to-agent orchestration is launch-via-herdr, human-triggered), but
> worth reopening because…_

An ADR records a decision and the options that were rejected, so it also records *why* the rejected
option lost. Check the **Considered Options** list before proposing something an ADR already
settled — a proposal that ignores a rejected option is weaker than one that answers it.

To add an ADR, follow the existing shape in `docs/adr/`: a `# ADR-000N: <decision as a claim>` title,
the decision itself, then `**Status**:`, `**Considered Options**:`, `**Consequences**:`. Number the
file `000N-<slug>.md` and keep numbering sequential.
