import { afterEach, expect, it } from "bun:test";
import { MAX_ATTACHMENT_BYTES } from "../../shared/attachments.ts";
import { AttachmentTooLargeError, searchConversations, uploadPaneImage } from "./api.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

it("refuses a file over the attachment limit before any of it is sent, and sends one at the limit", async () => {
  const requests: string[] = [];
  globalThis.fetch = (async (url: string) => {
    requests.push(url);
    return Response.json({ ok: true, path: "/work/.herdr-web-ui/site.zip" });
  }) as typeof fetch;

  const over = new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], "site.zip", { type: "application/zip" });
  const refused = await uploadPaneImage("p1", over).catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(AttachmentTooLargeError);
  expect(refused).toMatchObject({ fileName: "site.zip", size: MAX_ATTACHMENT_BYTES + 1 });
  expect(requests).toEqual([]);

  const atLimit = new File([new Uint8Array(MAX_ATTACHMENT_BYTES)], "site.zip", { type: "application/zip" });
  expect(await uploadPaneImage("p1", atLimit)).toBe("/work/.herdr-web-ui/site.zip");
  expect(requests).toEqual(["/api/pane/image"]);
});

it("asks each PC for its own conversation search, encoded, and passes the abort signal", async () => {
  const calls: Array<{ url: string; signal?: AbortSignal | null }> = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, signal: init?.signal });
    return Response.json({ matches: [], unavailable: 0 });
  }) as typeof fetch;

  const controller = new AbortController();
  await searchConversations("post /payments", "pc-2", controller.signal);
  await searchConversations("export", "local");
  await searchConversations("monday", "local", undefined, 20);
  expect(calls.map((call) => call.url)).toEqual([
    "/api/machines/pc-2/conversation/search?q=post+%2Fpayments&limit=12",
    "/api/conversation/search?q=export&limit=12",
    "/api/conversation/search?q=monday&limit=12&pages=20",
  ]);
  expect(calls[0]!.signal).toBe(controller.signal);
});

it("refuses a 40 MiB file in the browser with the 32 MB limit named, before upload (regression: 8 MB limit on main)", async () => {
  globalThis.fetch = (async (): Promise<Response> => { throw new Error("must not upload"); }) as unknown as typeof fetch;
  const refused = await uploadPaneImage("p1", new File([new Uint8Array(40 * 1024 * 1024)], "big.zip", { type: "application/zip" })).catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(AttachmentTooLargeError);
  expect((refused as Error).message).toContain("32 MB");
  expect(MAX_ATTACHMENT_BYTES).toBe(32 * 1024 * 1024);
});
