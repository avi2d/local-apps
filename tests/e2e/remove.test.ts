import { expect, test } from "bun:test";

const removeWith = async (body: string) => {
  const server = Bun.serve({ port: 0, fetch: () => new Response(body, { status: 404 }) });
  try {
    const process = Bun.spawn(["bun", "src/index.ts", "remove", "notes"], {
      env: { ...Bun.env, LOCAL_APPS_GATEWAY: server.url.origin, LOCAL_APPS_TOKEN: "test", LOCAL_APPS_FRPC_PASSWORD: "test" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    return { exitCode, output: stdout + stderr };
  } finally {
    await server.stop(true);
  }
};

test("a gateway 404 fails instead of reporting the app absent", async () => {
  const result = await removeWith("404 page not found");
  expect(result.exitCode).not.toBe(0);
  expect(result.output).toContain("registry: cannot remove notes");
});

test("the registry's not-found reason reports the app absent instead of an error", async () => {
  const result = await removeWith(JSON.stringify({ reason: "no app has that name" }));
  expect(result.exitCode).toBe(0);
  expect(result.output).toContain("notes is not registered");
});

test("a different JSON 404 fails instead of reporting the app absent", async () => {
  const result = await removeWith(JSON.stringify({ reason: "route not found" }));
  expect(result.exitCode).not.toBe(0);
  expect(result.output).toContain("registry: cannot remove notes");
});
