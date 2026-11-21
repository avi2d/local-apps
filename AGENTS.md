# Project agent memory

`README.md` holds what a person reads.

## Repository setup

- `@avi2dg/checks` owns the tool configs and the workflows, so change them through `bunx checks-workflows --write` and `bunx checks-setup` rather than by hand, as `.github/workflows/ci.yml` runs them.
- Run `bun run lint` and `bun run typecheck` before a commit.
- Keep machine addresses, tokens and hostnames out of the repository, since `README.md` documents a public tool.
