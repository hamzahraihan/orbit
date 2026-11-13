import { describe, expect, it } from "bun:test";
import { fail, files, lineOf, matches, read, stripComments } from "../scripts/source-scan.ts";
import { ConversationUnavailable as HubConversationUnavailable } from "./conversation.ts";
import { ConversationUnavailable as SharedConversationUnavailable } from "./conversation-shared.ts";

// Server rules from AGENTS.md and server/AGENTS.md that used to be prose only. Each failure says
// what to change; client rules are in src/conventions.test.ts, repo-wide ones in
// scripts/conventions.test.ts.

/** Server code that ships: not tests, not test stand-ins. */
const serverCode = (): string[] => files("server/**/*.{ts,mjs,js}").filter((file) => !/\.test\.ts$|\.fake\.ts$/.test(file));

describe("PTY sidecar boundary", () => {
  // node-pty panics Bun (oven-sh/bun#18546): only the Node sidecar loads it. `Bun.resolveSync`
  // in server/pty/sidecar.ts only finds the package for Node and is not a load.
  const NODE_SIDE = new Set(["server/pty/pty-host.mjs", "server/pty/smoke.mjs"]);
  const LOAD = /\bfrom\s*["'](?:@lydell\/)?node-pty[^"']*["']|\bimport\s*\(?\s*["'](?:@lydell\/)?node-pty[^"']*["']|\b(?:require|createRequire\s*\([^()]*(?:\([^()]*\))?[^()]*\))\s*\(\s*["'](?:@lydell\/)?node-pty[^"']*["']/;

  it("loads node-pty only in the Node sidecar", () => {
    // this file names the package in its own examples
    const code = [...files("{server,src,shared,scripts,site}/**/*.{ts,tsx,mjs,cjs,js}"), "vite.config.ts"].filter((file) => file !== "server/conventions.test.ts");
    const loads = matches(code, LOAD);
    fail(loads.filter((load) => !NODE_SIDE.has(load.file)).map((load) => load.at),
      "node-pty must never load inside Bun (AGENTS.md, Bridge invariants). PTY work goes through the Node sidecar server/pty/pty-host.mjs via PtySession (server/pty/session.ts).");
    expect(loads.map((load) => load.file)).toContain("server/pty/pty-host.mjs");
  });

  it("knows an import from a mention", () => {
    expect(LOAD.test("import * as pty from \"@lydell/node-pty\";")).toBe(true);
    expect(LOAD.test("const pty = await import('node-pty')")).toBe(true);
    expect(LOAD.test("const pty = createRequire(import.meta.url)(\"@lydell/node-pty\");")).toBe(true);
    expect(LOAD.test("Bun.resolveSync(\"@lydell/node-pty\", import.meta.dir);")).toBe(false);
  });
});

describe("web push", () => {
  // web-push's sendNotification goes through node:https, which Bun does not carry the way it
  // needs; push.ts builds each request with generateRequestDetails and sends it with fetch.
  it("never calls sendNotification", () => {
    fail(matches(files("{server,src,shared,scripts}/**/*.{ts,tsx,mjs,js}").filter((file) => !file.endsWith(".test.ts")), /\bsendNotification\b/).map((match) => match.at),
      "Web push requests are built with webpush.generateRequestDetails and sent with fetch (server/push.ts); never call sendNotification (AGENTS.md, Bridge invariants).");
  });
});

/** The text of the `{ … }` that opens at `open`, strings respected. */
function braces(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === "\"" || ch === "'" || ch === "`") {
      for (i += 1; i < code.length && code[i] !== ch; i += code[i] === "\\" ? 2 : 1);
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}" && --depth === 0) return code.slice(open, i + 1);
  }
  return code.slice(open);
}

describe("error bodies", () => {
  // Every error body is `{ error: { code, message } }` (AGENTS.md, Changing a contract): the
  // client reads `code` to decide and shows `message`. JSON answers go through jsonResponse or
  // its wrappers in server/http.ts, so the content type and the envelope stay one shape.
  it("builds JSON answers only through server/http.ts", () => {
    fail(matches(serverCode().filter((file) => file !== "server/http.ts"), /\bResponse\.json\s*\(|new Response\s*\(\s*JSON\.stringify/).map((match) => match.at),
      "Answer JSON with jsonResponse, errorResponse, badRequest or conflictResponse from server/http.ts, not Response.json or new Response(JSON.stringify(…)).");
  });

  /** An answer built from an object literal: jsonResponse or a local wrapper around it (`reply`, `fail`). */
  const ANSWER = /\b(?:jsonResponse|reply|fail)\s*\(\s*\{/;
  /** The value of the object's own top-level `error` key (strings blanked), or null when it has none. */
  const errorValue = (object: string): string | null => {
    for (let i = 1, depth = 0; i < object.length; i++) {
      const ch = object[i]!;
      if ("{[(".includes(ch)) depth += 1;
      else if ("}])".includes(ch)) depth -= 1;
      else if (depth === 0 && /^(?<![\w$.])error\s*:/.test(object.slice(i)) && !/[\w$.]/.test(object[i - 1]!)) {
        return object.slice(i).replace(/^error\s*:\s*/, "");
      }
    }
    return null;
  };
  /** Whether the answer at `at` has an error body other than `{ error: { code, message } }`. */
  const malformed = (code: string, at: number): boolean => {
    const blank = stripComments(code.slice(at), { strings: true });
    const object = braces(blank, blank.indexOf("{"));
    const value = errorValue(object);
    if (value === null) return false;
    if (!value.startsWith("{")) return true;
    const body = braces(value, 0);
    return !/\bcode\s*[:,}]/.test(body) || !/\bmessage\s*[:,}]/.test(body);
  };

  it("gives every error body both a code and a message", () => {
    const bodies = matches(serverCode(), ANSWER).filter((match) => errorValue(braces(stripComments(match.code.slice(match.index), { strings: true }), match.code.indexOf("{", match.index) - match.index)) !== null);
    expect(bodies.length).toBeGreaterThan(30);
    fail(bodies.filter((match) => malformed(match.code, match.index)).map((match) => match.at),
      "An error body is { error: { code, message } } with a snake_case code: use badRequest(code, message) or conflictResponse(code, message) from server/http.ts, errorResponse(error) for a thrown error, or jsonResponse({ error: { code, message } }, status) for another status.");
  });

  it("reads an error body's shape", () => {
    expect(malformed("return jsonResponse({ error: \"nope\" }, 400);", 7)).toBe(true);
    expect(malformed("return reply({ error: { code: \"x\" } }, 400);", 7)).toBe(true);
    expect(malformed("return jsonResponse({ error: { code, message: a ? b : \"c\" } }, 503);", 7)).toBe(false);
    expect(malformed("return jsonResponse({ error: { message: \"invalid pairing code\" } }, 400);", 7)).toBe(true);
    expect(malformed("return jsonResponse({ ok: false, error: \"nope\" }, 400);", 7)).toBe(true);
    expect(malformed("return jsonResponse({ ok: true, data: { error: \"kept\" } });", 7)).toBe(false);
    expect(ANSWER.test("this.patch({ phase: \"error\", error: \"failed\" });")).toBe(false);
  });
});

/**
 * Unix-socket connections opened in `code` (comments removed): Bun.connect with `unix:` or with
 * options it cannot read, and node:net's connect or createConnection (named, default or namespace
 * import, or require) called with `path:` or with a single path-like argument.
 */
function unixConnects(file: string, code: string): { file: string; at: string; bun: boolean }[] {
  const at = (index: number) => `${file}:${lineOf(code, index)}: ${code.split("\n")[lineOf(code, index) - 1]!.trim().slice(0, 160)}`;
  /** The first argument of the call whose `(` ends at `open`. */
  const argument = (open: number): string => {
    const rest = code.slice(open).trimStart();
    return rest.startsWith("{") ? braces(rest, 0) : /^[^,)]*/.exec(rest)![0].trim();
  };
  const found: { file: string; at: string; bun: boolean }[] = [];
  for (const match of code.matchAll(/\bBun\.connect\s*(?:<[^>]*>)?\s*\(/g)) {
    const arg = argument(match.index + match[0].length);
    if (!arg.startsWith("{") || /\bunix\s*:/.test(arg)) found.push({ file, at: at(match.index), bun: true });
  }
  const names: string[] = [];
  for (const match of code.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*["'](?:node:)?net["']/g)) {
    for (const item of match[1]!.matchAll(/\b(connect|createConnection)\b(?:\s+as\s+(\w+))?/g)) names.push(item[2] ?? item[1]!);
  }
  for (const match of code.matchAll(/\bimport\s+(?:\*\s*as\s+)?(\w+)\s*(?:,\s*\{[^}]*\}\s*)?from\s*["'](?:node:)?net["']|\b(?:const|let|var)\s+(\w+)\s*=\s*(?:require|await\s+import)\s*\(\s*["'](?:node:)?net["']\s*\)/g)) {
    const space = match[1] ?? match[2]!;
    names.push(`${space}.connect`, `${space}.createConnection`);
  }
  if (!names.length) return found;
  for (const match of code.matchAll(new RegExp(`(?<![\\w.])(?:${names.map((name) => name.replace(".", "\\.")).join("|")})\\s*\\(`, "g"))) {
    const arg = argument(match.index + match[0].length);
    // TCP is `{ host, port }` or `(port, host)`; a path, an options object with `path:` or anything unreadable is a unix socket
    if (arg.startsWith("{") ? /\bpath\s*:/.test(arg) : !/^\d|port/i.test(arg)) found.push({ file, at: at(match.index), bun: false });
  }
  return found;
}

describe("herdr socket", () => {
  // herdr closes the socket after each answer, so every RPC opens its own connection in
  // server/herdr/client.ts (no pooling), and only server/collector.ts holds a status
  // subscription (AGENTS.md, Bridge invariants).
  const UNIX_CONNECT_ALLOWED: Record<string, string> = {
    "server/herdr/client.ts": "the one herdr RPC client: one connection per call, plus subscribeEvents",
    "server/herdr-marker.ts": "a liveness probe: connects and ends at once, sends no request",
  };
  const NET_CONNECT_ALLOWED: Record<string, string> = {
    "server/ssh-askpass.ts": "the SSH askpass helper's own private socket, not herdr's",
  };

  it("opens herdr's socket only in server/herdr/client.ts", () => {
    const uses = serverCode().flatMap((file) => unixConnects(file, stripComments(read(file))));
    expect(uses.map((use) => use.file)).toContain("server/herdr/client.ts");
    fail(uses.filter((use) => !(use.file in (use.bun ? UNIX_CONNECT_ALLOWED : NET_CONNECT_ALLOWED))).map((use) => use.at),
      "Call herdr through the typed wrappers in server/herdr/client.ts: one connection per call, never a pooled or second client. A unix socket that is not herdr's gets an entry with its reason in UNIX_CONNECT_ALLOWED (Bun.connect) or NET_CONNECT_ALLOWED (node:net) in server/conventions.test.ts. A TCP connection (`{ host, port }`) is not flagged.");
  });

  it("tells a unix socket from a TCP one", () => {
    const found = (code: string) => unixConnects("example.ts", code).length;
    expect(found("Bun.connect({ unix: path, socket })")).toBe(1);
    expect(found("Bun.connect(options)")).toBe(1);
    expect(found("Bun.connect({ hostname: \"127.0.0.1\", port, socket })")).toBe(0);
    expect(found("import { connect as dial } from \"node:net\";\ndial({ path: \"/tmp/herdr.sock\" });")).toBe(1);
    expect(found("import net from \"node:net\";\nnet.createConnection({ path: socketPath });")).toBe(1);
    expect(found("import * as net from \"node:net\";\nnet.connect(process.env.HERDR_SOCKET_PATH);")).toBe(1);
    expect(found("import { connect as tcpConnect, createServer } from \"node:net\";\ntcpConnect({ host, port });\ntcpConnect(port, host);")).toBe(0);
  });

  // Server code calls herdr through the typed wrappers in server/herdr/client.ts (paneProcessInfo,
  // agentGet, paneSendText, paneSendKeys, …), never through herdrRpc itself: the wrapper is where a
  // method's params are typed (server/herdr/methods.ts), so `{ target }` to pane.process_info does
  // not compile there. herdrRpc's untyped fallback still takes any params given an explicit result
  // type, so this guard is what keeps server code off it. These files still call herdrRpc because
  // open PRs change them; a follow-up PR moves them to the wrappers once those PRs land.
  const HERDR_RPC_ALLOWED: Record<string, string> = {
    "server/conversation.ts": "open PRs #869 #912 #923 change it",
    "server/claude-transcript.ts": "todo 7 moved Claude's pane.process_info and agent.get calls out of server/conversation.ts",
    "server/gjc-runtime.ts": "open PR #912 changes it",
    "server/hermes.ts": "open PR #910 changes it",
    "server/omo.ts": "open PR #923 changes it",
    "server/shell-agent.ts": "open PRs #885 #923 change it",
  };
  // Files that do not call herdrRpc on main yet but whose open PR adds a `pane.process_info` call.
  // They are exempt from the "no longer calls" check below. Remove an entry when its PR switches to
  // paneProcessInfo(paneId) (the better outcome), merges, or closes.
  const HERDR_RPC_PENDING: Record<string, string> = {
    "server/gjc-status.ts": "open PR #928 adds a call",
    "server/index.ts": "open PR #859 adds a call",
  };

  it("calls herdrRpc only inside server/herdr/", () => {
    const uses = matches(serverCode().filter((file) => !file.startsWith("server/herdr/")), /\bherdrRpc\b/);
    fail(uses.filter((use) => !(use.file in HERDR_RPC_ALLOWED) && !(use.file in HERDR_RPC_PENDING)).map((use) => use.at),
      "Do not call herdrRpc outside server/herdr/: add a typed wrapper in server/herdr/client.ts (its method in HerdrMethods, server/herdr/methods.ts) and call that; for pane status use the server/collector.ts listeners. Files waiting on open PRs are listed in HERDR_RPC_ALLOWED in server/conventions.test.ts; do not add new ones.");
    const users = new Set(uses.map((use) => use.file));
    fail(Object.keys(HERDR_RPC_ALLOWED).filter((file) => !users.has(file)),
      "These files no longer call herdrRpc: remove them from HERDR_RPC_ALLOWED in server/conventions.test.ts.");
  });

  it("subscribes to status only in server/collector.ts", () => {
    const subscribers = matches(serverCode(), /\bsubscribeEvents\b/).filter((match) => match.file !== "server/herdr/client.ts" && match.file !== "server/collector.ts");
    const raw = matches(files("{server,src,shared,scripts}/**/*.{ts,tsx,mjs,js}").filter((file) => !file.endsWith(".test.ts")), /["']events\.subscribe["']/).filter((match) => match.file !== "server/herdr/client.ts");
    fail([...subscribers, ...raw].map((match) => match.at),
      "server/collector.ts is the only status subscription (startStatusCollector), and `events.subscribe` is sent only by subscribeEvents in server/herdr/client.ts: take pane status from the collector's callbacks (onStatus, onPaneEnded, onBaseline) in server/index.ts instead of subscribing again.");
  });
});

describe("conversation module graph", () => {
  // server/conversation.ts is the hub: it resolves every provider and calls its readers, and a
  // provider names the vocabulary they share. A provider importing the hub back leaves a runtime
  // cycle (and loads every other reader behind the first), so both edges stay one-way: the
  // vocabulary lives in server/conversation-shared.ts, which imports no provider.
  const HUB = "server/conversation.ts";
  const SHARED = "server/conversation-shared.ts";

  // The back-edges into a conversation module that are allowed, keyed `importer -> hub`, each with
  // its reason. An entry is honest only while that import is `import type`: a type is erased, so the
  // module never loads at runtime and no cycle exists. Keep it empty unless the code proves the
  // exception.
  const CONVERSATION_CYCLE_ALLOWED: Record<string, string> = {
    [`server/conversation-cache.ts -> ${SHARED}`]: "the cache names TurnSource from the shared vocabulary as a type: erased at runtime, no cycle",
  };

  /** A file's static imports and re-exports that name a relative module: its target, line and whether it is type-only. */
  const edgesOf = (file: string) => {
    const code = stripComments(read(file));
    const edges = /\b(?:import|export)\s+(type\s+)?(?:[^;]*?\bfrom\s*)?["']([^"']+)["']/g;
    return [...code.matchAll(edges)].flatMap((match) => {
      const specifier = match[2]!;
      if (!specifier.startsWith(".")) return [];
      const resolved: string[] = [];
      for (const part of `${file.slice(0, file.lastIndexOf("/"))}/${specifier}`.split("/")) {
        if (part === "" || part === ".") continue;
        if (part === "..") resolved.pop();
        else resolved.push(part);
      }
      const line = lineOf(code, match.index!);
      return [{ file, target: resolved.join("/"), at: `${file}:${line}: ${code.split("\n")[line - 1]!.trim().slice(0, 160)}`, typeOnly: match[1] !== undefined }];
    });
  };

  /** The back-edges into `hub`: the server modules it imports that import it in turn. */
  const backEdges = (hub: string) => {
    const importers = [...new Set(edgesOf(hub).map((edge) => edge.target))].filter((target) => /^server\/.*\.ts$/.test(target));
    return importers.flatMap((importer) => edgesOf(importer).filter((edge) => edge.target === hub).map((edge) => ({ ...edge, key: `${importer} -> ${hub}` })));
  };

  const importShared = `Import the shared vocabulary from ${SHARED} instead, or add a justified entry to CONVERSATION_CYCLE_ALLOWED in server/conventions.test.ts (only for an \`import type\` edge).`;

  it("keeps the providers off the conversation hub", () => {
    fail(backEdges(HUB).filter((edge) => !(edge.key in CONVERSATION_CYCLE_ALLOWED)).map((edge) => edge.at),
      `${HUB} imports a module that imports it back. ${importShared}`);
  });

  it("keeps the shared vocabulary free of the hub", () => {
    fail(edgesOf(SHARED).filter((edge) => edge.target === HUB).map((edge) => edge.at),
      `${SHARED} must import nothing from ${HUB}: a provider naming a type from the shared module would load the whole hub, cycle included. Move the vocabulary it needs into ${SHARED}.`);
  });

  it("allows only type-only edges back into the shared vocabulary", () => {
    const back = backEdges(SHARED);
    fail(back.filter((edge) => !(edge.key in CONVERSATION_CYCLE_ALLOWED)).map((edge) => edge.at),
      `${SHARED} imports a module that imports it back. ${importShared}`);
    // The allowlist says "a type, erased at runtime"; a value import turns it into a real cycle.
    fail(back.filter((edge) => edge.key in CONVERSATION_CYCLE_ALLOWED && !edge.typeOnly).map((edge) => edge.at),
      "CONVERSATION_CYCLE_ALLOWED allows this back-edge only because it is `import type`; it imports values now, which is a runtime cycle. Make it `import type`, or remove the entry and the edge.");
    const present = new Set([...backEdges(HUB), ...back].map((edge) => edge.key));
    fail(Object.keys(CONVERSATION_CYCLE_ALLOWED).filter((key) => !present.has(key)),
      "These CONVERSATION_CYCLE_ALLOWED entries no longer match an edge into a conversation module: remove them from server/conventions.test.ts.");
  });
});

describe("conversation symbol identity", () => {
  // A symbol moved to the shared vocabulary but still re-exported from conversation.ts must be the
  // one class: a route that catches a provider's error compares it against the constructor the
  // thrower used, so two definitions would let a caught ConversationUnavailable fall through.
  it("re-exports ConversationUnavailable from the hub as the shared class", () => {
    expect(HubConversationUnavailable).toBe(SharedConversationUnavailable);
    const error = new HubConversationUnavailable("pane_gone");
    expect(error).toBeInstanceOf(SharedConversationUnavailable);
    expect(error).toBeInstanceOf(HubConversationUnavailable);
  });
});
