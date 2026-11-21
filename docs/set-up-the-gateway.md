---
kind: how-to
---
# Set up the gateway

Do this once for a group of machines, before the first `local-apps register`.
One machine runs the frp server, one runs the registry, and every machine runs frpc and the agent.

## Before you begin

- frp v0.72.0 from its GitHub releases page, with the archive checked against the release's `frp_sha256_checksums.txt`.
- A private network that every machine reaches, such as a VPN, and the gateway machine's address on it.
  The examples use 192.0.2.10.
- Four random secrets: the frp token, the dashboard password, the frpc admin password and the registry token.
  `openssl rand -hex 32` prints one.

## Run the frp server

To run frps on the gateway machine:

1. Write `frps.toml`:

   ```toml
   bindAddr = "192.0.2.10"
   proxyBindAddr = "192.0.2.10"
   bindPort = 7100
   vhostHTTPPort = 8090
   auth.method = "token"
   auth.token = "<frp token>"
   transport.tls.force = true
   webServer.addr = "127.0.0.1"
   webServer.port = 7500
   webServer.user = "admin"
   webServer.password = "<dashboard password>"
   ```

1. Run `frps -c frps.toml`.

frps listens for clients and for app traffic on the private address only, and serves its dashboard on loopback only.
It refuses a client without the frp token or without TLS.

## Run frpc on each machine

To run frpc on a machine:

1. Write `frpc.toml`:

   ```toml
   serverAddr = "192.0.2.10"
   serverPort = 7100
   auth.method = "token"
   auth.token = "<frp token>"
   transport.tls.enable = true
   webServer.addr = "127.0.0.1"
   webServer.port = 7400
   webServer.user = "admin"
   webServer.password = "<frpc admin password>"

   [store]
   path = "/var/lib/local-apps/frpc-store.json"
   ```

1. Run `frpc -c frpc.toml`.

The `[store]` table turns on the admin API that `local-apps` uses to create and remove routes while frpc runs.
The admin API listens on loopback only and asks for the admin password.

## Run the registry

To run the registry on one machine that runs frpc:

1. Set `LOCAL_APPS_TOKEN` to the registry token and `LOCAL_APPS_FRPC_PASSWORD` to the frpc admin password.
1. Run `local-apps hub` and keep it running.

The registry keeps its list in `~/.local/state/local-apps/registry.json`.
Set `LOCAL_APPS_HUB_STATE` to keep it elsewhere, such as `/var/lib/local-apps/registry.json`.

The registry listens on loopback only, and every machine reaches it through the gateway as `hub.<domain>`.
Every request to it needs the registry token.

## Run the agent on each machine

To run the agent on a machine:

1. Set `LOCAL_APPS_MACHINE` to a name for this machine, such as `laptop`.
1. Set `LOCAL_APPS_TOKEN` and `LOCAL_APPS_FRPC_PASSWORD` as for the registry.
1. Set `LOCAL_APPS_GATEWAY` to the gateway, such as `http://192.0.2.10:8090`.
1. Run `local-apps agent` and keep it running.

`register`, `list` and `remove` read the same settings on that machine.
`src/config.ts` holds every setting and its default.

## Open an app in a browser

The address of an app is `http://<name>.<domain>:<gateway port>/`, and `LOCAL_APPS_DOMAIN` sets the domain.
The default domain is `localhost`, which a browser resolves to its own machine, so the default works where the gateway port is on loopback.
Elsewhere, set `LOCAL_APPS_DOMAIN` on every machine to a domain whose names resolve to the gateway address on your private network, such as `apps.example.test`.
The `local-apps` command names the registry by its host header, so the command itself needs no name to resolve.

## Troubleshooting

### a setting is missing or wrong: Expected string at ["LOCAL_APPS_TOKEN"]

The command ran without the registry token.
Set `LOCAL_APPS_TOKEN` as [Run the agent on each machine](#run-the-agent-on-each-machine) says.

### registry: cannot list apps: missing or wrong bearer token

The token on this machine differs from the token the registry runs with.
Set `LOCAL_APPS_TOKEN` to the registry token.

## Related topics

- [How local-apps keeps its list true](how-it-works.md)
- [README](../README.md)
