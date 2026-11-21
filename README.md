# local-apps

local-apps keeps one list of the apps running on your own machines.
Each entry names the app, the machine it runs on, its port, its owner and whether it answers.
It is for people and agents who start demo apps on more than one machine and need a link that still works.

## Before you begin

- Bun, at the version `.bun-version` pins.
- Git, to clone the repository.

## Install

To install the repository for development:

1. Clone `https://github.com/avi2d/local-apps`.
1. Run `bun install` in the clone.

## Check a change

To run the checks a pull request runs:

1. Run `bun run lint` to run oxlint and the gates of `@avi2dg/checks`.
1. Run `bun run build` to check the Effect scope of `tsconfig.json`.
1. Run `bun run typecheck` to run TypeScript and the Effect diagnostics.

The workflows under `.github/workflows/` run the same scripts on every pull request.
