/**
 * The browser demo (site/demo/transport.ts) is the app itself, served from fixtures instead of a
 * server. `bun run build:site` rebuilds the client on every deploy, so the demo's *code* is never
 * stale — but `site/demo/fixtures/*.json` are captured by hand from a staged herdr
 * (`bun run demo:fixtures`, POSIX only), and nothing rebuilt them. The 2026-09-26 capture kept
 * answering after the client moved on, so the demo quietly drifted from the real app.
 *
 *   bun run demo:check
 *
 * Every problem found is reported, not just the first, so one stale fixture cannot hide the rest.
 * Each message says what to change; all of them are fixed by recapturing on a POSIX host.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repo } from "./source-scan.ts";
import { SPECS } from "../site/demo/fixtures.ts";

const read = (file: string): string => readFileSync(join(repo, file), "utf8");

interface Pane {
  pane_id: string;
  workspace_id: string;
  tab_id: string;
  terminal_id: string;
  label?: string | null;
  agent?: string | null;
  agent_status: string;
  revision?: number;
}
interface Snapshot {
  workspaces: Array<{ workspace_id: string; label: string }>;
  tabs: Array<{ tab_id: string; workspace_id: string }>;
  panes: Pane[];
  agents: Array<{ pane_id: string; agent_status: string }>;
  layouts: Array<{ tab_id: string }>;
}

const problems: string[] = [];
const problem = (message: string): void => { problems.push(message); };

/** Every string literal a union declaration allows, by the type's name. */
function unionValues(source: string, name: string): string[] {
  const at = source.search(new RegExp(`export type ${name}\\s*=`));
  if (at < 0) return [];
  const rest = source.slice(at);
  const end = rest.indexOf("\n\nexport ");
  return [...(end < 0 ? rest : rest.slice(0, end)).matchAll(/["']([\w.-]+)["']/g)].map((match) => match[1]!);
}

// ---- fixtures fit the protocol the app reads ----------------------------------------------------

const roster = JSON.parse(read("site/demo/fixtures/machines.json")) as {
  machines: Array<{ id: string; kind: string; snapshot: Snapshot | null }>;
};
const snap = (roster.machines.find((machine) => machine.kind === "local") ?? roster.machines[0])?.snapshot ?? null;
if (!snap) problem("site/demo/fixtures/machines.json holds no local snapshot, so the demo would draw an empty sidebar. Recapture with `bun run demo:fixtures`.");
else {
  const workspaces = new Set(snap.workspaces.map((workspace) => workspace.workspace_id));
  const tabs = new Set(snap.tabs.map((tab) => tab.tab_id));
  const kinds = new Set(unionValues(read("shared/herdr-api.generated.ts"), "AgentStatus"));
  for (const pane of snap.panes) {
    if (!workspaces.has(pane.workspace_id)) problem(`machines.json: pane ${pane.pane_id} names workspace ${pane.workspace_id}, which the snapshot does not list; the demo hides that pane.`);
    if (!tabs.has(pane.tab_id)) problem(`machines.json: pane ${pane.pane_id} names tab ${pane.tab_id}, which the snapshot does not list; the demo hides that pane.`);
    if (typeof pane.revision !== "number") problem(`machines.json: pane ${pane.pane_id} has no revision, so the demo refuses its pane updates as stale.`);
    // herdr widens AgentStatus with `(string & {})`, so an unknown value is legal on the wire; what
    // this catches is a value the app's own union no longer names, which draws no state at all.
    if (kinds.size && !kinds.has(pane.agent_status)) problem(`machines.json: pane ${pane.pane_id} has agent_status "${pane.agent_status}", which shared/herdr-api.generated.ts AgentStatus does not name.`);
  }
  for (const agent of snap.agents) if (kinds.size && !kinds.has(agent.agent_status)) problem(`machines.json: agent ${agent.pane_id} has agent_status "${agent.agent_status}", which AgentStatus does not name.`);
  for (const tab of snap.tabs) if (!workspaces.has(tab.workspace_id)) problem(`machines.json: tab ${tab.tab_id} names workspace ${tab.workspace_id}, which the snapshot does not list.`);
  for (const layout of snap.layouts) if (!tabs.has(layout.tab_id)) problem(`machines.json: the pane layout for ${layout.tab_id} names a tab the snapshot does not list.`);
}

// ---- the recorded roster is the roster the demo lays out ----------------------------------------

// transport.ts layOutRoster drops a recorded pane only when no spec names it through panes.json.
// A spec whose `worktreeOf` or `tabOf` folds into its parent keeps its pane id, so the ids are what
// must agree — not each pane's workspace, which the layout step rewrites.
const paneIds = new Set((snap?.panes ?? []).map((pane) => pane.pane_id));
const panes = JSON.parse(read("site/demo/fixtures/panes.json")) as Record<string, string>;
for (const spec of SPECS) {
  const pane = panes[spec.key];
  if (!pane) problem(`panes.json: no pane for the "${spec.key}" spec, so the demo invents one and the browser checks that name it break.`);
  else if (!paneIds.has(pane)) problem(`panes.json: "${spec.key}" is ${pane}, which machines.json does not hold, so the demo invents a pane for it. panes.json and machines.json come from the same capture; recapture them together.`);
}
const named = new Set(Object.values(panes));
for (const pane of snap?.panes ?? []) if (!named.has(pane.pane_id)) problem(`machines.json: pane ${pane.pane_id} is in no spec and no panes.json entry, so the demo drops it.`);

// the shell pane replays a recording; an empty one is a blank terminal in the demo. `pane` names the
// spec (scripts/demo-fixtures.ts writes `pane: "shell"`); the pane it recorded is panes.json's.
const terminal = JSON.parse(read("site/demo/fixtures/terminal.json")) as { pane: string; frames: unknown[] };
if (!SPECS.some((spec) => spec.key === terminal.pane)) problem(`terminal.json: it records "${terminal.pane}", which is no spec in site/demo/fixtures.ts.`);
else if (!paneIds.has(panes[terminal.pane] ?? "")) problem(`terminal.json: it records the "${terminal.pane}" spec, whose pane panes.json gives as ${panes[terminal.pane] ?? "(none)"}, which machines.json does not hold.`);
if (!terminal.frames?.length) problem("terminal.json: no frames, so the demo's release tab is blank.");

// ---- the fixture rows the app reads field by field ------------------------------------------------

const agents = JSON.parse(read("site/demo/fixtures/agents.json")) as { agents?: Array<{ kind?: string; label?: string; installed?: boolean }> };
if (!agents.agents?.length) problem("agents.json: no agents, so the demo's new-session dialog offers none.");
else for (const agent of agents.agents) {
  if (!agent.kind) problem(`agents.json: a row with no kind (${JSON.stringify(agent)}), which src/lib/api.ts fetchAgentKinds drops.`);
  else if (!agent.label) problem(`agents.json: the agent "${agent.kind}" has no label, which src/components/AgentPicker.tsx draws as an empty row.`);
}

const commands = JSON.parse(read("site/demo/fixtures/commands.json")) as { commands?: Array<{ name?: string; description?: string }> };
if (!commands.commands?.length) problem("commands.json: no slash commands, so the demo's composer offers none.");
else for (const command of commands.commands) if (!command.name) problem(`commands.json: a command with no name (${JSON.stringify(command)}).`);

// ---- a fixture never names the PC it was captured on --------------------------------------------

const leaks = [process.env["USERNAME"], process.env["USERPROFILE"], process.env["COMPUTERNAME"], process.env["HOME"], process.env["USER"]]
  .filter((value): value is string => !!value && value.length > 3 && !value.includes("\\") && !value.includes("/"));
for (const file of ["machines.json", "agents.json", "commands.json", "panes.json", "terminal.json"]) {
  const text = read(`site/demo/fixtures/${file}`);
  for (const leak of leaks.filter((value) => text.includes(value))) problem(`${file}: it names this PC ("${leak}"); \`bun run demo:fixtures\` scrubs the hostname and login, so recapture it there.`);
}

if (problems.length) {
  for (const message of problems) console.error(`FAIL ${message}`);
  console.error(`\ndemo-check: ${problems.length} problem(s). Recapture with \`bun run demo:fixtures\` on a POSIX host (docs/development.md, "The browser demo").`);
  process.exit(1);
}
console.log("demo-check: fixtures match the app that serves them");