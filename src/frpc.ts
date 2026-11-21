import { Context, Effect, flow, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { domain as domainSetting, frpcSettings } from "./config";

export class FrpcError extends Schema.TaggedError<FrpcError>()("FrpcError", {
  message: Schema.String,
}) {}

// frp metadata marks the proxies this tool owns, so a sweep never touches a proxy a person made by hand.
const owner = "local-apps";
export type RouteKind = "app" | "hub";

const proxyName = (name: string): string => `la-${name}`;
const appOf = (proxy: string): string => proxy.slice("la-".length);

const StoreList = Schema.Struct({
  proxies: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      http: Schema.optionalKey(
        Schema.Struct({
          localPort: Schema.optionalKey(Schema.Number),
          metadatas: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
        }),
      ),
    }),
  ),
});

const StatusList = Schema.Record(Schema.String, Schema.Array(Schema.Struct({ name: Schema.String, status: Schema.String })));

export class Frpc extends Context.Service<
  Frpc,
  {
    ensure(route: { readonly name: string; readonly port: number; readonly kind: RouteKind }): Effect.Effect<void, FrpcError>;
    remove(name: string): Effect.Effect<void, FrpcError>;
    readonly appRoutes: Effect.Effect<ReadonlyArray<{ readonly name: string; readonly port: number | undefined }>, FrpcError>;
    readonly running: Effect.Effect<ReadonlySet<string>, FrpcError>;
  }
>()("local-apps/Frpc") {
  static readonly layer = Layer.effect(
    Frpc,
    Effect.gen(function* () {
      const { admin, user, password } = yield* frpcSettings;
      const domain = yield* domainSetting;
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(flow(HttpClientRequest.prependUrl(admin.origin), HttpClientRequest.basicAuth(user, password))),
      );
      const failed = (action: string) => (cause: { readonly message: string }) =>
        new FrpcError({ message: `frpc admin API: cannot ${action}: ${cause.message}` });
      const refused = (action: string, response: HttpClientResponse.HttpClientResponse) =>
        response.text.pipe(
          Effect.orElseSucceed(() => ""),
          Effect.flatMap((body) => new FrpcError({ message: `frpc admin API: cannot ${action}: ${response.status} ${body.trim()}` })),
        );

      const ensure = Effect.fn("Frpc.ensure")(function* (route: { readonly name: string; readonly port: number; readonly kind: RouteKind }) {
        const name = proxyName(route.name);
        const body = {
          name,
          type: "http",
          http: {
            localIP: "127.0.0.1",
            localPort: route.port,
            customDomains: [`${route.name}.${domain}`],
            metadatas: { [owner]: route.kind },
          },
        };
        const created = yield* HttpClientRequest.post("/api/store/proxies").pipe(
          HttpClientRequest.bodyJsonUnsafe(body),
          client.execute,
          Effect.mapError(failed(`create ${name}`)),
        );
        if (created.status === 200) return;
        if (created.status !== 409) return yield* refused(`create ${name}`, created);
        const updated = yield* HttpClientRequest.put(`/api/store/proxies/${name}`).pipe(
          HttpClientRequest.bodyJsonUnsafe(body),
          client.execute,
          Effect.mapError(failed(`update ${name}`)),
        );
        if (updated.status !== 200) return yield* refused(`update ${name}`, updated);
      });

      // A proxy already gone counts as removed, so a retried cleanup succeeds.
      const remove = Effect.fn("Frpc.remove")(function* (app: string) {
        const name = proxyName(app);
        const response = yield* client.del(`/api/store/proxies/${name}`).pipe(Effect.mapError(failed(`remove ${name}`)));
        if (response.status !== 200 && response.status !== 404) return yield* refused(`remove ${name}`, response);
      });

      const appRoutes = client.get("/api/store/proxies").pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(StoreList)),
        Effect.map(({ proxies }) =>
          proxies
            .filter((proxy) => proxy.name.startsWith("la-") && proxy.http?.metadatas?.[owner] === "app")
            .map((proxy) => ({ name: appOf(proxy.name), port: proxy.http?.localPort })),
        ),
        Effect.mapError(failed("list proxies")),
      );

      const running = client.get("/api/status").pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(StatusList)),
        Effect.map((byType) =>
          new Set(
            Object.values(byType)
              .flat()
              .filter((proxy) => proxy.status === "running" && proxy.name.startsWith("la-"))
              .map((proxy) => appOf(proxy.name)),
          ),
        ),
        Effect.mapError(failed("read proxy status")),
      );

      return Frpc.of({ ensure, remove, appRoutes, running });
    }),
  );
}
