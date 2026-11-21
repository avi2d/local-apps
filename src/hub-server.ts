import * as Path from "node:path";
import { BunHttpServer } from "@effect/platform-bun";
import { Clock, Context, Effect, FileSystem, Layer, Option, Redacted, Ref, Result, Schedule, Schema, SynchronizedRef } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { domain as domainSetting, gateway as gatewaySetting, hubSettings, serverSettings } from "./config";
import { Frpc } from "./frpc";
import {
  AppList,
  appUrl,
  type AppView,
  claim,
  hubName,
  type MachineSeen,
  MachineReport,
  Refused,
  Registration,
  viewOf,
} from "./domain";

const staleAfterMs = 15_000;

class RegistryError extends Schema.TaggedError<RegistryError>()("RegistryError", {
  message: Schema.String,
}) {}

class OwnerQueryError extends Schema.TaggedError<OwnerQueryError>()("OwnerQueryError", {
  message: Schema.String,
}) {}

const Stored = Schema.fromJsonString(Schema.Array(Registration));
const decodeStored = Schema.decodeUnknownEffect(Stored);

const OwnerQuery = Schema.Struct({
  machine: Schema.optionalKey(Schema.NonEmptyString),
  ownerPid: Schema.optionalKey(Schema.String),
});

class Registry extends Context.Service<
  Registry,
  {
    readonly list: Effect.Effect<AppList>;
    add(registration: Registration): Effect.Effect<{ readonly added: boolean; readonly view: AppView }, Refused | RegistryError>;
    remove(
      name: string,
      expected?: { readonly machine: string; readonly ownerPid: number },
    ): Effect.Effect<Option.Option<Registration>, RegistryError | Refused>;
    report(machine: string, report: MachineReport): Effect.Effect<ReadonlyArray<Registration>>;
  }
>()("local-apps/Registry") {
  static readonly layer = Layer.effect(
    Registry,
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { stateFile } = yield* serverSettings;
      const gateway = yield* gatewaySetting;
      const domain = yield* domainSetting;
      const failed = (action: string) => (cause: { readonly message: string }) =>
        new RegistryError({ message: `cannot ${action} ${stateFile}: ${cause.message}` });

      const initial = (yield* fs.exists(stateFile).pipe(Effect.mapError(failed("read"))))
        ? yield* fs.readFileString(stateFile).pipe(Effect.flatMap(decodeStored), Effect.mapError(failed("read")))
        : [];
      const entries = yield* SynchronizedRef.make<ReadonlyArray<Registration>>(initial);
      const seen = yield* Ref.make<ReadonlyMap<string, MachineSeen>>(new Map());

      const save = (next: ReadonlyArray<Registration>) =>
        fs.makeDirectory(Path.dirname(stateFile), { recursive: true }).pipe(
          Effect.andThen(fs.writeFileString(`${stateFile}.tmp`, `${JSON.stringify(next, null, 2)}\n`)),
          Effect.andThen(fs.rename(`${stateFile}.tmp`, stateFile)),
          Effect.mapError(failed("write")),
        );

      const view = (registration: Registration) =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const machines = yield* Ref.get(seen);
          return viewOf(registration, machines.get(registration.machine), {
            now,
            staleAfterMs,
            url: appUrl(gateway, registration.name, domain),
          });
        });

      const list = Effect.gen(function* () {
        const current = yield* SynchronizedRef.get(entries);
        const sorted = [...current].sort((a, b) => a.machine.localeCompare(b.machine) || a.name.localeCompare(b.name));
        return new AppList({ apps: yield* Effect.forEach(sorted, view) });
      });

      const add = Effect.fn("Registry.add")(function* (registration: Registration) {
        const added = yield* SynchronizedRef.modifyEffect(entries, (current): Effect.Effect<readonly [boolean, ReadonlyArray<Registration>], Refused | RegistryError> => {
          const verdict = claim(current, registration);
          if (Result.isFailure(verdict)) return Effect.fail(verdict.failure);
          if (verdict.success === "unchanged") return Effect.succeed([false, current] as const);
          const next = [...current, registration];
          return save(next).pipe(Effect.as([true, next] as const));
        });
        return { added, view: yield* view(registration) };
      });

      const remove = Effect.fn("Registry.remove")(
        function* (name: string, expected?: { readonly machine: string; readonly ownerPid: number }) {
          return yield* SynchronizedRef.modifyEffect(entries, (current): Effect.Effect<readonly [Option.Option<Registration>, ReadonlyArray<Registration>], Refused | RegistryError> => {
            const found = current.find((entry) => entry.name === name);
            if (found === undefined) return Effect.succeed([Option.none<Registration>(), current] as const);
            if (expected !== undefined && (found.machine !== expected.machine || found.ownerPid !== expected.ownerPid)) {
              return Effect.fail(new Refused({ reason: `${name} is now registered with a different owner` }));
            }
            const next = current.filter((entry) => entry.name !== name);
            return save(next).pipe(Effect.as([Option.some(found), next] as const));
          });
        },
      );

      const report = Effect.fn("Registry.report")(function* (machine: string, machineReport: MachineReport) {
        const at = yield* Clock.currentTimeMillis;
        yield* Ref.update(seen, (machines) =>
          new Map(machines).set(machine, { at, apps: new Map(machineReport.apps.map((app) => [app.name, app])) }),
        );
        const current = yield* SynchronizedRef.get(entries);
        return current.filter((entry) => entry.machine === machine);
      });

      return Registry.of({ list, add, remove, report });
    }),
  );
}

const reply = (body: unknown, status: number) => HttpServerResponse.jsonUnsafe(body, { status });
const refuse = (reason: string, status: number) => reply({ reason }, status);

const sameText = (a: string, b: string): boolean => {
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a.codePointAt(index) ?? 0) ^ (b.codePointAt(index) ?? 0);
  }
  return difference === 0;
};

const guarded = <E, R>(
  token: Redacted.Redacted,
  handler: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>,
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const given = request.headers["authorization"] ?? "";
    if (!sameText(given, `Bearer ${Redacted.value(token)}`)) return refuse("missing or wrong bearer token", 401);
    // A failed write of the state file is the registry's fault, while anything else is a request it cannot read.
    return yield* handler.pipe(
      Effect.catch((error: unknown) =>
        Effect.succeed(
          error instanceof RegistryError
            ? refuse(error.message, 500)
            : refuse(error instanceof Error ? error.message : "the request could not be read", 400),
        ),
      ),
    );
  });

const routes = Layer.unwrap(
  Effect.gen(function* () {
    const { token } = yield* hubSettings;
    const registry = yield* Registry;
    return Layer.mergeAll(
      HttpRouter.add(
        "GET",
        "/apps",
        guarded(token, registry.list.pipe(Effect.map((apps) => reply(apps, 200)))),
      ),
      HttpRouter.add(
        "POST",
        "/apps",
        guarded(
          token,
          HttpServerRequest.schemaBodyJson(Registration).pipe(
            Effect.flatMap((registration) => registry.add(registration)),
            Effect.map(({ added, view }) => reply(view, added ? 201 : 200)),
            Effect.catchTag("Refused", ({ reason }) => Effect.succeed(refuse(reason, 409))),
          ),
        ),
      ),
      HttpRouter.add(
        "DELETE",
        "/apps/:name",
        guarded(
          token,
          Effect.all([HttpRouter.params, HttpServerRequest.schemaSearchParams(OwnerQuery)]).pipe(
            Effect.flatMap(([{ name }, query]): Effect.Effect<Option.Option<Registration>, Refused | RegistryError | OwnerQueryError> => {
              if (query.machine === undefined && query.ownerPid === undefined) return registry.remove(name ?? "");
              if (query.machine === undefined || query.ownerPid === undefined) {
                return Effect.fail(new OwnerQueryError({ message: "send both machine and ownerPid, or neither" }));
              }
              const ownerPid = Number(query.ownerPid);
              if (!Number.isInteger(ownerPid) || ownerPid <= 0) {
                return Effect.fail(new OwnerQueryError({ message: "ownerPid is not a positive integer" }));
              }
              return registry.remove(name ?? "", { machine: query.machine, ownerPid });
            }),
            Effect.map(
              Option.match({ onNone: () => refuse("no app has that name", 404), onSome: (found) => reply(found, 200) }),
            ),
            Effect.catchTag("Refused", ({ reason }) => Effect.succeed(refuse(reason, 409))),
          ),
        ),
      ),
      HttpRouter.add(
        "POST",
        "/machines/:machine/report",
        guarded(
          token,
          Effect.all([HttpRouter.params, HttpServerRequest.schemaBodyJson(MachineReport)]).pipe(
            Effect.flatMap(([{ machine }, machineReport]) => registry.report(machine ?? "", machineReport)),
            Effect.map((apps) => reply({ apps }, 200)),
          ),
        ),
      ),
    );
  }),
);

const hubRoute = (port: number) =>
  Effect.gen(function* () {
    const frpc = yield* Frpc;
    yield* Effect.acquireRelease(
      frpc.ensure({ name: hubName, port, kind: "hub" }).pipe(
        Effect.tapError((error) => Effect.logWarning(`${error.message}, retrying`)),
        Effect.retry({ schedule: Schedule.spaced("2 seconds"), times: 30 }),
      ),
      () => frpc.remove(hubName).pipe(Effect.catchTag("FrpcError", (error) => Effect.logWarning(error.message))),
    );
  });

export const serveHub = Effect.gen(function* () {
  const { port } = yield* serverSettings;
  const server = HttpRouter.serve(routes, { disableLogger: true }).pipe(
    Layer.provide(Registry.layer),
    Layer.provide(BunHttpServer.layer({ port, hostname: "127.0.0.1" })),
  );
  yield* hubRoute(port);
  return yield* Layer.launch(server);
}).pipe(Effect.scoped);
