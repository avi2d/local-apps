import { Context, Effect, flow, Layer, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { hubSettings } from "./config";
import { AppList, AppView, hubName, type MachineReport, Refused, Registration } from "./domain";

export class HubError extends Schema.TaggedError<HubError>()("HubError", {
  message: Schema.String,
}) {}

const Reason = Schema.Struct({ reason: Schema.String });
const Assigned = Schema.Struct({ apps: Schema.Array(Registration) });

export class Hub extends Context.Service<
  Hub,
  {
    register(registration: Registration): Effect.Effect<AppView, HubError | Refused>;
    readonly list: Effect.Effect<AppList, HubError>;
    remove(
      name: string,
      expected?: { readonly machine: string; readonly ownerPid: number },
    ): Effect.Effect<Option.Option<Registration>, HubError | Refused>;
    report(machine: string, report: MachineReport): Effect.Effect<ReadonlyArray<Registration>, HubError>;
  }
>()("local-apps/Hub") {
  static readonly layer = Layer.effect(
    Hub,
    Effect.gen(function* () {
      const { gateway, domain, token } = yield* hubSettings;
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(
          flow(
            HttpClientRequest.prependUrl(gateway.origin),
            HttpClientRequest.setHeader("host", `${hubName}.${domain}`),
            HttpClientRequest.bearerToken(Redacted.value(token)),
            HttpClientRequest.acceptJson,
          ),
        ),
      );
      const failed = (action: string) => (cause: { readonly message: string }) =>
        new HubError({ message: `registry: cannot ${action}: ${cause.message}` });
      const reasonOf = (response: HttpClientResponse.HttpClientResponse) =>
        HttpClientResponse.schemaBodyJson(Reason)(response).pipe(
          Effect.map(({ reason }) => reason),
          Effect.orElseSucceed(() => `status ${response.status}`),
        );
      const unexpected = (action: string, response: HttpClientResponse.HttpClientResponse) =>
        reasonOf(response).pipe(Effect.flatMap((reason) => new HubError({ message: `registry: cannot ${action}: ${reason}` })));

      const register = Effect.fn("Hub.register")(function* (registration: Registration) {
        const action = `register ${registration.name}`;
        const response = yield* HttpClientRequest.post("/apps").pipe(
          HttpClientRequest.bodyJsonUnsafe(registration),
          client.execute,
          Effect.mapError(failed(action)),
        );
        if (response.status === 409) return yield* reasonOf(response).pipe(Effect.flatMap((reason) => new Refused({ reason })));
        if (response.status !== 200 && response.status !== 201) return yield* unexpected(action, response);
        return yield* HttpClientResponse.schemaBodyJson(AppView)(response).pipe(Effect.mapError(failed(action)));
      });

      const list = Effect.gen(function* () {
        const response = yield* client.get("/apps").pipe(Effect.mapError(failed("list apps")));
        if (response.status !== 200) return yield* unexpected("list apps", response);
        return yield* HttpClientResponse.schemaBodyJson(AppList)(response).pipe(Effect.mapError(failed("list apps")));
      });

      const remove = Effect.fn("Hub.remove")(
        function* (name: string, expected?: { readonly machine: string; readonly ownerPid: number }) {
          const action = `remove ${name}`;
          const target =
            expected === undefined
              ? `/apps/${encodeURIComponent(name)}`
              : `/apps/${encodeURIComponent(name)}?machine=${encodeURIComponent(expected.machine)}&ownerPid=${expected.ownerPid}`;
          const response = yield* client.del(target).pipe(Effect.mapError(failed(action)));
          if (response.status === 404) {
            const reason = yield* reasonOf(response);
            if (reason === "no app has that name") return Option.none<Registration>();
            return yield* new HubError({ message: `registry: cannot ${action}: ${reason}` });
          }
          if (response.status === 409) return yield* reasonOf(response).pipe(Effect.flatMap((reason) => new Refused({ reason })));
          if (response.status !== 200) return yield* unexpected(action, response);
          return Option.some(yield* HttpClientResponse.schemaBodyJson(Registration)(response).pipe(Effect.mapError(failed(action))));
        },
      );

      const report = Effect.fn("Hub.report")(function* (machine: string, machineReport: MachineReport) {
        const action = `report for ${machine}`;
        const response = yield* HttpClientRequest.post(`/machines/${encodeURIComponent(machine)}/report`).pipe(
          HttpClientRequest.bodyJsonUnsafe(machineReport),
          client.execute,
          Effect.mapError(failed(action)),
        );
        if (response.status !== 200) return yield* unexpected(action, response);
        const { apps } = yield* HttpClientResponse.schemaBodyJson(Assigned)(response).pipe(Effect.mapError(failed(action)));
        return apps;
      });

      return Hub.of({ register, list, remove, report });
    }),
  );
}
