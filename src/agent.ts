import { Clock, Effect, Ref, Schedule, Schema } from "effect";
import { HttpClient } from "effect/http";
import { machineName } from "./config";
import { AppReport, isExpired, MachineReport, type Registration } from "./domain";
import { Frpc } from "./frpc";
import { Hub } from "./hub-client";

class SignalRefused extends Schema.TaggedError<SignalRefused>()("SignalRefused", {
  permissionDenied: Schema.Boolean,
}) {}

// EPERM means the process exists under another user, which still counts as alive.
const ownerSeen = (pid: number) =>
  Effect.try({
    try: () => process.kill(pid, 0),
    catch: (cause) =>
      new SignalRefused({ permissionDenied: typeof cause === "object" && cause !== null && "code" in cause && cause.code === "EPERM" }),
  }).pipe(
    Effect.as("alive" as const),
    Effect.catchTag("SignalRefused", ({ permissionDenied }) => Effect.succeed(permissionDenied ? ("alive" as const) : ("ended" as const))),
  );

export const runAgent = Effect.gen(function* () {
  const machine = yield* machineName;
  const hub = yield* Hub;
  const frpc = yield* Frpc;
  const http = yield* HttpClient.HttpClient;
  const assigned = yield* Ref.make<ReadonlyArray<Registration>>([]);

  const healthSeen = (port: number) =>
    http.get(`http://127.0.0.1:${port}/`).pipe(
      Effect.timeout("2 seconds"),
      Effect.map((response) => (response.status < 500 ? ("healthy" as const) : ("unhealthy" as const))),
      Effect.orElseSucceed(() => "unhealthy" as const),
    );

  const observe = (running: ReadonlySet<string>) => (registration: Registration) =>
    Effect.all({ owner: ownerSeen(registration.ownerPid), health: healthSeen(registration.port) }).pipe(
      Effect.map(
        ({ owner, health }) =>
          new AppReport({ name: registration.name, owner, health, route: running.has(registration.name) ? "up" : "down" }),
      ),
    );

  const reportOn = (registrations: ReadonlyArray<Registration>) =>
    Effect.gen(function* () {
      const running = yield* frpc.running;
      const apps = yield* Effect.forEach(registrations, observe(running), { concurrency: 8 });
      return yield* hub.report(machine, new MachineReport({ apps }));
    });

  const names = (registrations: ReadonlyArray<Registration>): string =>
    registrations
      .map((registration) => registration.name)
      .sort()
      .join(" ");

  const cleanUp = (registration: Registration, why: string) =>
    hub.remove(registration.name, { machine: registration.machine, ownerPid: registration.ownerPid }).pipe(
      Effect.flatMap(() => frpc.remove(registration.name)),
      Effect.andThen(Effect.log(`removed ${registration.name}: ${why}`)),
      Effect.catchTag("Refused", ({ reason }) => Effect.log(`kept ${registration.name}: ${reason}`)),
    );

  const tick = Effect.gen(function* () {
    // Routes are read before the report, so a route made after it cannot be swept as an orphan.
    const routes = yield* frpc.appRoutes;
    const previous = yield* Ref.get(assigned);
    const answered = yield* reportOn(previous);
    // A newly assigned app is reported at once rather than a tick later.
    const next = names(answered) === names(previous) ? answered : yield* reportOn(answered);
    yield* Ref.set(assigned, next);
    const now = yield* Clock.currentTimeMillis;
    const present = new Set(routes);
    for (const registration of next) {
      if (isExpired(registration, now)) {
        yield* cleanUp(registration, "its registration expired");
      } else if ((yield* ownerSeen(registration.ownerPid)) === "ended") {
        yield* cleanUp(registration, `its owner, process ${registration.ownerPid}, ended`);
      } else if (!present.has(registration.name)) {
        yield* frpc.ensure({ name: registration.name, port: registration.port, kind: "app" });
      }
    }
    const kept = new Set(next.map((registration) => registration.name));
    for (const orphan of routes.filter((route) => !kept.has(route))) {
      yield* frpc.remove(orphan);
      yield* Effect.log(`removed the route of ${orphan}: the registry no longer lists it`);
    }
  });

  yield* Effect.log(`agent for ${machine} started`);
  return yield* tick.pipe(
    Effect.catch((error) => Effect.logWarning(error.message)),
    Effect.repeat(Schedule.spaced("5 seconds")),
    Effect.andThen(Effect.never),
  );
});
