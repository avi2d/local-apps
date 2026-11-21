# local-apps

local-apps keeps one list of the apps running on your machines.
Each entry names the app, its machine, its port, the process that owns it and whether the app answers.
Every app gets a stable address through a private frp gateway, and its entry and route go when its owner ends.
Any machine can register, list or remove an app with the `local-apps` command.

## Before you begin

- Bun, at the version `.bun-version` pins.
- A frp gateway and frpc on each machine, set up as [Set up the gateway](docs/set-up-the-gateway.md) says.

## Install

To install the `local-apps` command:

1. Clone `https://github.com/avi2d/local-apps`.
1. Run `bun install` in the clone.
1. Run `bun link` in the clone to put `local-apps` on your path.

`local-apps --version` prints the version `package.json` holds.

## Register an app

To add an app that runs on this machine:

1. Start the app on a port of this machine, such as 4100.
1. Run `local-apps register notes --port 4100 --pid <owner pid>`, where the owner is the process whose end removes the entry.

The command prints the address of the app, such as `http://notes.localhost:8090/`.
A name is unique across machines, and a port is unique on its own machine, so two machines can both use port 4100.
Add `--ttl <minutes>` to expire the entry even while its owner runs.

## List the apps

Run `local-apps list` to print every app with its owner, route and health.
Add `--json` to print one JSON object instead of the table.

## Remove an app

Run `local-apps remove notes` on any machine.
On the app's own machine the command also takes its route down at once, and otherwise the agent on that machine sweeps it.
A second `remove` of the same name changes nothing.

## Check a change

To run the checks a pull request runs:

1. Run `bun run lint` to run oxlint and the gates of `@avi2dg/checks`.
1. Run `bun run build` to check the Effect scope of `tsconfig.json`.
1. Run `bun run typecheck` to run TypeScript and the Effect diagnostics.

The workflows under `.github/workflows/` run the same scripts on every pull request.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/index.ts` | The `local-apps` command and its subcommands |
| `src/domain.ts` | The rules for names, ports and states |
| `src/hub-server.ts` | The registry that `local-apps hub` serves |
| `src/hub-client.ts` | The registry client the command and the agent share |
| `src/agent.ts` | The agent that `local-apps agent` runs on each machine |
| `src/frpc.ts` | The client of the frpc admin API |
| `src/config.ts` | Every setting, read from the environment, with its default |
| `tests/unit/` | The unit tests, which `bun run test` runs |

## Related topics

- [Set up the gateway](docs/set-up-the-gateway.md)
- [How local-apps keeps its list true](docs/how-it-works.md)
