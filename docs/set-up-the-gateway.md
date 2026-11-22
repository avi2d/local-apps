---
kind: how-to
---
# Set up the gateway

Do this once for a group of machines, before the first `local-apps register`.
One machine runs the frp server, one runs the registry, and every machine runs frpc and the agent.

## Before you begin

- A private network that every machine reaches, such as a VPN, and the gateway machine's address on it.
  The examples use 192.0.2.10.
  The gateway machine needs an address that does not change, because frps listens on that address only.
  Without such a network, [reach the gateway over ssh](#reach-the-gateway-over-ssh) instead.
- The `local-apps` command on every machine, installed as the [README](../README.md#install) says.
- `openssl` on every machine, to make the secrets.

## Install frp

To install frp v0.72.0 on a machine:

1. Download the archive for the machine, such as `frp_0.72.0_darwin_arm64.tar.gz` or `frp_0.72.0_linux_amd64.tar.gz`, and `frp_sha256_checksums.txt` from the v0.72.0 page of the frp GitHub releases.
1. Run `grep frp_0.72.0_linux_amd64.tar.gz frp_sha256_checksums.txt | shasum -a 256 -c -` with the name of your archive, and go on only when it prints `OK`.
1. Unpack `frpc`, and `frps` on the gateway machine, into a directory of your own, such as `~/.local/opt/frp/0.72.0`.

## Make the secrets

Four secrets keep the gateway private:

| Secret | Where it goes |
| --- | --- |
| The frp token | `frps.toml` and every `frpc.toml` |
| The dashboard password | `frps.toml` |
| The frpc admin password | `frpc.toml` and `settings.env` on the same machine |
| The registry token | `settings.env` on every machine |

To make them:

1. On the gateway machine, run `openssl rand -hex 32` for the frp token, the dashboard password and the registry token.
   Write each output straight into its file rather than to the terminal.
1. On each machine, run `openssl rand -hex 32` for that machine's own frpc admin password.
1. Copy the frp token and the registry token to each other machine over ssh, so they pass through no other host.
   Pipe them into a script that `ssh` runs there, rather than putting them in a command line.
1. Run `chmod 600` on every file that holds a secret, and `chmod 700` on its directory.

## Run the frp server

To run frps on the gateway machine:

1. Write `~/.config/local-apps/frps.toml`:

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

1. Run `frps -c ~/.config/local-apps/frps.toml`.

frps listens for clients and for app traffic on the private address only, and serves its dashboard on loopback only.
It refuses a client without the frp token or without TLS.

## Run frpc on each machine

To run frpc on a machine:

1. Write `~/.config/local-apps/frpc.toml`, with the full path of your home directory in place of `/home/you`:

   ```toml
   serverAddr = "192.0.2.10"
   serverPort = 7100
   loginFailExit = false
   log.level = "warn"
   auth.method = "token"
   auth.token = "<frp token>"
   transport.tls.enable = true
   webServer.addr = "127.0.0.1"
   webServer.port = 7400
   webServer.user = "admin"
   webServer.password = "<frpc admin password>"

   [store]
   path = "/home/you/.local/state/local-apps/frpc-store.json"
   ```

1. Run `frpc -c ~/.config/local-apps/frpc.toml`.

The `[store]` table turns on the admin API that `local-apps` uses to create and remove routes while frpc runs.
The admin API listens on loopback only and asks for the admin password.
`loginFailExit = false` keeps frpc retrying while the gateway is not up yet, such as just after a restart.
`log.level = "warn"` keeps frpc from logging each admin request, which the agent makes every 5 seconds.

## Reach the gateway over ssh

When the machines share no private network, frps can listen on loopback only, and each other machine reaches it through an ssh tunnel from the gateway machine.
Nothing then listens on any network.

To set it up:

1. On the gateway machine, write `127.0.0.1` for `bindAddr` and `proxyBindAddr` in `frps.toml`.
1. On every machine, write `127.0.0.1` for `serverAddr` in `frpc.toml`, and `http://127.0.0.1:8090` for `LOCAL_APPS_GATEWAY` in the settings.
1. On the gateway machine, run `ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -R 127.0.0.1:7100:127.0.0.1:7100 -R 127.0.0.1:8090:127.0.0.1:8090 <other machine>` for each other machine, and keep it running.

The tunnel carries frpc's link to frps and each request to an app or the registry.
[Run local-apps as services](run-as-services.md) keeps the tunnel running.

## Write the settings

The command, the agent and the registry read their settings from the environment first, and then from `~/.config/local-apps/settings.env`.
Set `LOCAL_APPS_SETTINGS` to read another file.

To write the settings on a machine:

1. Write `~/.config/local-apps/settings.env`:

   ```sh
   LOCAL_APPS_MACHINE=laptop
   LOCAL_APPS_GATEWAY=http://192.0.2.10:8090
   LOCAL_APPS_TOKEN=<registry token>
   LOCAL_APPS_FRPC_PASSWORD=<frpc admin password of this machine>
   ```

1. Run `chmod 600 ~/.config/local-apps/settings.env`.

`LOCAL_APPS_MACHINE` names this machine, and each machine takes a name of its own.
Set `LOCAL_APPS_FRPC_ADMIN` when frpc's admin API listens on a port other than 7400.
`src/config.ts` holds every setting and its default.

## Run the registry

To run the registry on one machine that runs frpc:

1. Write the settings on that machine.
1. Run `local-apps hub` and keep it running.

The registry keeps its list in `~/.local/state/local-apps/registry.json`.
Set `LOCAL_APPS_HUB_STATE` to keep it elsewhere, such as `/var/lib/local-apps/registry.json`.

The registry listens on loopback only, and every machine reaches it through the gateway as `hub.<domain>`.
Every request to it needs the registry token.

## Run the agent on each machine

To run the agent on a machine:

1. Write the settings on that machine.
1. Run `local-apps agent` and keep it running.

`register`, `list` and `remove` read the same settings on that machine.
To start frps, frpc, the registry and the agent with the machine, follow [Run local-apps as services](run-as-services.md).

## Open an app in a browser

The address of an app is `http://<name>.<domain>:<gateway port>/`, and `LOCAL_APPS_DOMAIN` sets the domain.
The default domain is `localhost`, which a browser resolves to its own machine, so the default works where the gateway port is on loopback.
Elsewhere, set `LOCAL_APPS_DOMAIN` on every machine to a domain whose names resolve to the gateway address on your private network, such as `apps.example.test`.
The `local-apps` command names the registry by its host header, so the command itself needs no name to resolve.

## Troubleshooting

### a setting is missing or wrong: Expected string at ["LOCAL_APPS_TOKEN"]

The command found no registry token in the environment or in the settings file.
Write the settings as [Write the settings](#write-the-settings) says.

### registry: cannot list apps: missing or wrong bearer token

The token on this machine differs from the token the registry runs with.
Set `LOCAL_APPS_TOKEN` to the registry token.

### frps: bind: can't assign requested address

The gateway machine does not hold the address in `bindAddr`, such as while its VPN is down or after its address changed.
Give the gateway machine a fixed address on the private network, and frps starts once the address is back.

## Related topics

- [Run local-apps as services](run-as-services.md)
- [How local-apps keeps its list true](how-it-works.md)
- [README](../README.md)
