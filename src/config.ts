import * as os from "node:os";
import { Config, ConfigProvider, Effect, FileSystem, Schema } from "effect";

export const machineName = Config.NonEmptyString("LOCAL_APPS_MACHINE");

export const gateway = Config.URL("LOCAL_APPS_GATEWAY").pipe(Config.withDefault(new URL("http://127.0.0.1:8090")));

export const domain = Config.NonEmptyString("LOCAL_APPS_DOMAIN").pipe(Config.withDefault("localhost"));

export const hubSettings = Config.all({ gateway, domain, token: Config.Redacted("LOCAL_APPS_TOKEN") });

export const frpcSettings = Config.all({
  admin: Config.URL("LOCAL_APPS_FRPC_ADMIN").pipe(Config.withDefault(new URL("http://127.0.0.1:7400"))),
  user: Config.NonEmptyString("LOCAL_APPS_FRPC_USER").pipe(Config.withDefault("admin")),
  password: Config.Redacted("LOCAL_APPS_FRPC_PASSWORD"),
});

class SettingsFileError extends Schema.TaggedError<SettingsFileError>()("SettingsFileError", {
  message: Schema.String,
}) {}

const settingsFile = `${os.homedir()}/.config/local-apps/settings.env`;

// The environment wins over the file.
export const settingsFileLayer = ConfigProvider.layerAdd(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const unreadable = (cause: { readonly message: string }) =>
      new SettingsFileError({ message: `cannot read the settings file ${settingsFile}: ${cause.message}` });
    if (!(yield* fs.exists(settingsFile).pipe(Effect.mapError(unreadable)))) return ConfigProvider.fromUnknown({});
    return yield* ConfigProvider.fromDotEnv({ path: settingsFile }).pipe(Effect.mapError(unreadable));
  }),
);

export const serverSettings = Config.all({
  port: Config.Port("LOCAL_APPS_HUB_PORT").pipe(Config.withDefault(7600)),
  stateFile: Config.NonEmptyString("LOCAL_APPS_HUB_STATE").pipe(
    Config.withDefault(`${os.homedir()}/.local/state/local-apps/registry.json`),
  ),
});
