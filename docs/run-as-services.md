---
kind: how-to
---
# Run local-apps as services

Do this on each machine after [Set up the gateway](set-up-the-gateway.md).
frps, frpc, the registry and the agent then start with the machine, and start again when they stop.
macOS runs them as launchd agents of your user, and Linux runs them as systemd units of your user.
Neither needs root, and no service file holds a secret, since the secrets stay in the files under `~/.config/local-apps/`.

## Before you begin

- frp, the settings and the secrets on the machine, as [Set up the gateway](set-up-the-gateway.md) says.
- The full path of the `bun` binary, since a service does not read your shell's `PATH`.
  Use the binary itself rather than a shim or a wrapper script.
- The full path of `src/index.ts` in your clone of local-apps.

## Run the services on macOS

To run them under launchd:

1. Write `~/Library/LaunchAgents/local-apps.agent.plist`, with your paths in place of `/Users/you` and the bun path:

   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>Label</key>
     <string>local-apps.agent</string>
     <key>ProgramArguments</key>
     <array>
       <string>/Users/you/.bun/bin/bun</string>
       <string>/Users/you/local-apps/src/index.ts</string>
       <string>agent</string>
     </array>
     <key>RunAtLoad</key>
     <true/>
     <key>KeepAlive</key>
     <true/>
     <key>ThrottleInterval</key>
     <integer>10</integer>
     <key>StandardOutPath</key>
     <string>/Users/you/Library/Logs/local-apps/agent.log</string>
     <key>StandardErrorPath</key>
     <string>/Users/you/Library/Logs/local-apps/agent.log</string>
   </dict>
   </plist>
   ```

1. Write `local-apps.frpc.plist` the same way, with `frpc`, `-c` and the path of `frpc.toml` as its program arguments.
1. On the gateway machine, write `local-apps.frps.plist` with `frps`, `-c` and the path of `frps.toml`.
1. On the registry machine, write `local-apps.hub.plist` with bun, `src/index.ts` and `hub`.
1. When you [reach the gateway over ssh](set-up-the-gateway.md#reach-the-gateway-over-ssh), write `local-apps.tunnel.<machine>.plist` for each other machine, with the label `local-apps.tunnel.<machine>` and `/usr/bin/ssh`, `-o BatchMode=yes` and the tunnel's arguments, one per string.
   `<machine>` is the other machine's `LOCAL_APPS_MACHINE`, so each tunnel has its own label and file.
1. Run `mkdir -p ~/Library/Logs/local-apps`.
1. Run `plutil -lint` on each file, then `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local-apps.agent.plist` for each.

`launchctl print gui/$(id -u)/local-apps.agent` shows whether a service runs and its last exit status.
launchd starts the tunnel again when it drops, after the 10 seconds `ThrottleInterval` sets.
The ssh key for the tunnel has to work without a prompt, such as from an agent launchd services can reach.
A launchd agent of your user starts when you log in.
A Mac that serves other machines therefore needs automatic login, or a login after each restart.

The macOS application firewall asks once whether frps may accept incoming connections.
Allow it, or run `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add` and `--unblockapp` with the path of `frps`.
The firewall keys its answer to that path, so a new frp version in a new directory asks again.

## Run the services on Linux

To run them under systemd:

1. Write `~/.config/systemd/user/local-apps-frpc.service`, with your paths in place of `/home/you`:

   ```ini
   [Unit]
   Description=local-apps frpc
   After=network-online.target

   [Service]
   ExecStart=/home/you/.local/opt/frp/0.72.0/frpc -c /home/you/.config/local-apps/frpc.toml
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=default.target
   ```

1. Write `~/.config/systemd/user/local-apps-agent.service`:

   ```ini
   [Unit]
   Description=local-apps agent
   After=local-apps-frpc.service
   Wants=local-apps-frpc.service

   [Service]
   ExecStart=/home/you/.bun/bin/bun /home/you/local-apps/src/index.ts agent
   Restart=always
   RestartSec=5

   [Install]
   WantedBy=default.target
   ```

1. Run `loginctl enable-linger` once, so your units start at boot without a login.
1. Run `systemctl --user daemon-reload`, then `systemctl --user enable --now local-apps-frpc local-apps-agent`.

`systemctl --user status local-apps-agent` shows whether the agent runs, and `journalctl --user -u local-apps-agent` shows its log.
Under WSL, turn on systemd with `systemd=true` in the `[boot]` table of `/etc/wsl.conf`.
The units then run while the WSL machine runs, and WSL stops that machine when nothing holds it open.

## Troubleshooting

### launchctl bootstrap: Bootstrap failed: 5: Input/output error

The service is already loaded.
Run `launchctl bootout gui/$(id -u)/local-apps.agent` first, then bootstrap it again.

## Related topics

- [Set up the gateway](set-up-the-gateway.md)
- [README](../README.md)
