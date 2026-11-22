import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { Config, ConfigProvider, Effect, FileSystem, Layer, Option, Redacted } from "effect";
import { machineName, settingsFileLayer } from "../../src/config";

const settingsPath = join(homedir(), ".config", "local-apps", "settings.env");

const withSettings = (environment: Record<string, string>, file: string | undefined) =>
  settingsFileLayer.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(environment))),
    Layer.provide(
      FileSystem.layerNoop({
        exists: (path) => Effect.succeed(file !== undefined && path === settingsPath),
        readFileString: () => Effect.succeed(file ?? ""),
      }),
    ),
  );

describe("settingsFileLayer", () => {
  test("a setting in the environment wins over the file, not the file's value", () => {
    const layer = withSettings({ LOCAL_APPS_MACHINE: "from-environment" }, "LOCAL_APPS_MACHINE=from-file\n");
    expect(Effect.runSync(Effect.provide(machineName, layer))).toBe("from-environment");
  });

  test("a setting only the file holds is read, not reported missing", () => {
    const layer = withSettings({}, "# the registry token\nLOCAL_APPS_TOKEN=secret-from-file\n");
    const token = Effect.runSync(Effect.provide(Config.Redacted("LOCAL_APPS_TOKEN"), layer));
    expect(Redacted.value(token)).toBe("secret-from-file");
  });

  test("a missing settings file adds no settings instead of failing", () => {
    const layer = withSettings({}, undefined);
    expect(Option.isNone(Effect.runSync(Effect.provide(Config.option(machineName), layer)))).toBe(true);
  });
});
