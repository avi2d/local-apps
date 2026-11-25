import { expect, test } from "bun:test";
import packageJson from "../../package.json";

const checkVersion = (command: readonly string[]) => {
  const result = Bun.spawnSync([...command, "--version"], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe(`local-apps v${packageJson.version}`);
};

test("the compiled command prints the package version, not a different version", () => {
  const build = Bun.spawnSync(["bun", "run", "build:binary"], { stdout: "pipe", stderr: "pipe" });
  expect(build.exitCode).toBe(0);

  expect(() => checkVersion(["bun", "-e", 'console.log("wrong version")'])).toThrow();
  checkVersion(["./dist/local-apps"]);
}, 60_000);
