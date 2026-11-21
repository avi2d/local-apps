#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Clock, Config, Console, Effect, Layer, Option } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import packageJson from "../package.json";
import { runAgent } from "./agent";
import { machineName } from "./config";
import { AppName, type AppView, Registration } from "./domain";
import { Frpc } from "./frpc";
import { Hub, HubError } from "./hub-client";
import { serveHub } from "./hub-server";

const hubLayer = Hub.layer.pipe(Layer.provide(FetchHttpClient.layer));
const frpcLayer = Frpc.layer.pipe(Layer.provide(FetchHttpClient.layer));

const userError = (message: string) => new CliError.UserError({ cause: message });

// A person reads one line about the registry or a setting, not a stack trace.
const plainly = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  self.pipe(
    Effect.mapError((error) => {
      if (error instanceof HubError) return userError(error.message);
      if (error instanceof Config.ConfigError) {
        return userError(`a setting is missing or wrong: ${error.cause.message.replaceAll(/\s*\n\s*/g, " ")}`);
      }
      return error;
    }),
  );

const name = Argument.String("name").pipe(Argument.withDescription("The app's name, unique across machines"), Argument.withSchema(AppName));

const register = Command.make(
  "register",
  {
    name,
    port: Flag.Int("port").pipe(Flag.withDescription("The port the app listens on, on this machine")),
    pid: Flag.Int("pid").pipe(Flag.withDescription("The process that owns the app; the entry goes when it ends")),
    ttl: Flag.Int("ttl").pipe(Flag.withDescription("Minutes until the entry expires, whether or not its owner runs"), Flag.optional),
  },
  Effect.fn(function* ({ name: app, port, pid, ttl }) {
    const machine = yield* machineName;
    const now = yield* Clock.currentTimeMillis;
    const registration = new Registration({
      name: app,
      machine,
      port,
      ownerPid: pid,
      ...Option.match(ttl, { onNone: () => ({}), onSome: (minutes) => ({ expiresAt: now + minutes * 60_000 }) }),
    });
    const hub = yield* Hub;
    const view = yield* hub.register(registration).pipe(Effect.catchTag("Refused", ({ reason }) => Effect.fail(userError(reason))));
    yield* Console.log(`registered ${view.name} on ${view.machine} port ${view.port}: ${view.url}`);
    const frpc = yield* Frpc;
    yield* frpc.ensure({ name: app, port, kind: "app" }).pipe(
      Effect.catch((error) => Console.error(`${error.message}. The agent on ${machine} retries the route`)),
    );
  }, Effect.provide([hubLayer, frpcLayer]), plainly),
).pipe(Command.withDescription("Add an app running on this machine to the list and route it through the gateway"));

const columns = ["NAME", "MACHINE", "PORT", "OWNER", "ROUTE", "HEALTH", "URL"] as const;
const rowOf = (app: AppView): ReadonlyArray<string> => [
  app.name,
  app.machine,
  String(app.port),
  app.owner === "alive" ? `alive (pid ${app.ownerPid})` : app.owner,
  app.route,
  app.health,
  app.url,
];
const table = (apps: ReadonlyArray<AppView>): string => {
  const rows = [columns, ...apps.map(rowOf)];
  const widths = columns.map((_, index) => Math.max(...rows.map((row) => (row[index] ?? "").length)));
  return rows.map((row) => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd()).join("\n");
};

const list = Command.make(
  "list",
  { json: Flag.Boolean("json").pipe(Flag.withDescription("Print the list as one JSON object"), Flag.withDefault(false)) },
  Effect.fn(function* ({ json }) {
    const hub = yield* Hub;
    const { apps } = yield* hub.list;
    if (json) return yield* Console.log(JSON.stringify({ apps }));
    yield* Console.log(apps.length === 0 ? "no apps registered" : table(apps));
  }, Effect.provide(hubLayer), plainly),
).pipe(Command.withDescription("Print every registered app with its owner, route and health"));

const remove = Command.make(
  "remove",
  { name },
  Effect.fn(function* ({ name: app }) {
    const hub = yield* Hub;
    const removed = yield* hub.remove(app);
    if (Option.isNone(removed)) return yield* Console.log(`${app} is not registered`);
    const here = yield* Config.option(machineName);
    if (Option.isSome(here) && here.value === removed.value.machine) {
      const frpc = yield* Frpc;
      return yield* frpc.remove(app).pipe(
        Effect.andThen(Console.log(`removed ${app} and its route`)),
        Effect.catch((error) => Console.error(`removed ${app}. ${error.message}. The agent on ${here.value} sweeps the route`)),
      );
    }
    yield* Console.log(`removed ${app}; the agent on ${removed.value.machine} takes its route down`);
  }, Effect.provide([hubLayer, frpcLayer]), plainly),
).pipe(Command.withDescription("Take an app off the list and take its route down"));

const hub = Command.make("hub", {}, () => serveHub.pipe(Effect.provide(frpcLayer), plainly)).pipe(
  Command.withDescription("Run the registry on this machine, reached through the gateway as hub.<domain>"),
);

const agent = Command.make("agent", {}, () => runAgent.pipe(Effect.provide([hubLayer, frpcLayer, FetchHttpClient.layer]), plainly)).pipe(
  Command.withDescription("Watch this machine's apps: report owner, route and health, and clean up after an owner ends"),
);

const localApps = Command.make("local-apps").pipe(
  Command.withDescription("One list of the apps running on your machines, routed through a private frp gateway"),
  Command.withSubcommands([register, list, remove, hub, agent]),
);

BunRuntime.runMain(Command.run(localApps, { version: packageJson.version }).pipe(Effect.provide(BunServices.layer)));
