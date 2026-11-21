import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { AppReport, appUrl, claim, Registration, viewOf } from "../../src/domain";

const notes = new Registration({ name: "notes", machine: "laptop", port: 4100, ownerPid: 501 });

const outcome = (result: ReturnType<typeof claim>): string | undefined =>
  Result.isSuccess(result) ? result.success : undefined;

const refusal = (result: ReturnType<typeof claim>): string | undefined =>
  Result.isFailure(result) ? result.failure.reason : undefined;

describe("claim", () => {
  test("the same port on another machine is added, not refused as a collision", () => {
    const board = new Registration({ name: "board", machine: "desktop", port: 4100, ownerPid: 77 });
    expect(outcome(claim([notes], board))).toBe("added");
  });

  test("a second app on a taken port of the same machine is refused, not added", () => {
    const other = new Registration({ name: "other", machine: "laptop", port: 4100, ownerPid: 502 });
    expect(refusal(claim([notes], other))).toBe("port 4100 on laptop is already registered as notes");
  });

  test("a name taken on one machine is refused on another, not shared", () => {
    const twin = new Registration({ name: "notes", machine: "desktop", port: 4200, ownerPid: 1 });
    expect(refusal(claim([notes], twin))).toBe("notes is already registered on laptop port 4100");
  });

  test("the same claim sent again is unchanged, not refused as taken", () => {
    const retry = new Registration({ name: "notes", machine: "laptop", port: 4100, ownerPid: 501 });
    expect(outcome(claim([notes], retry))).toBe("unchanged");
  });

  test("the name of the registry route is refused for an app, not added", () => {
    const hub = new Registration({ name: "hub", machine: "laptop", port: 4998, ownerPid: 9 });
    expect(refusal(claim([], hub))).toBe("the name hub belongs to the registry");
  });
});

describe("viewOf", () => {
  const url = "http://notes.example.test:8090/";
  const report = (health: "healthy" | "unhealthy") =>
    new Map([["notes", new AppReport({ name: "notes", owner: "alive", route: "up", health })]]);

  test("a machine silent past the stale window shows unknown, not its last healthy report", () => {
    const view = viewOf(notes, { at: 1_000, apps: report("healthy") }, { now: 17_001, staleAfterMs: 16_000, url });
    expect([view.owner, view.route, view.health]).toEqual(["unknown", "unknown", "unknown"]);
  });

  test("a fresh report keeps owner, route and health apart, not one merged state", () => {
    const view = viewOf(notes, { at: 1_000, apps: report("unhealthy") }, { now: 17_000, staleAfterMs: 16_000, url });
    expect([view.owner, view.route, view.health]).toEqual(["alive", "up", "unhealthy"]);
  });

  test("a machine that never reported shows unknown, not healthy", () => {
    const view = viewOf(notes, undefined, { now: 0, staleAfterMs: 16_000, url });
    expect(view.health).toBe("unknown");
  });

  test("an entry past its expiry shows expired even while its owner is alive", () => {
    const leased = new Registration({ name: "notes", machine: "laptop", port: 4100, ownerPid: 501, expiresAt: 5_000 });
    const view = viewOf(leased, { at: 4_990, apps: report("healthy") }, { now: 5_000, staleAfterMs: 16_000, url });
    expect(view.owner).toBe("expired");
  });
});

describe("appUrl", () => {
  test("the url names the app under the gateway port, not the app's own port", () => {
    expect(appUrl(new URL("http://127.0.0.1:8090"), "notes", "example.test")).toBe("http://notes.example.test:8090/");
  });

  test("a gateway on the default port gives a url with no port, not a trailing colon", () => {
    expect(appUrl(new URL("https://gateway.example.test"), "notes", "example.test")).toBe("https://notes.example.test/");
  });
});
