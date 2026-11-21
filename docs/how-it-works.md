---
kind: explanation
---
# How local-apps keeps its list true

Who decides what the list says, and how does an entry leave it?
The registry decides who holds a name and a port.
The agent on each machine reports what it sees and cleans up after an owner ends.

## The registry owns names and ports

The registry keeps the list in one file and refuses a claim that breaks a rule.
A name belongs to one app across all machines, and the person who registers chooses it, so it never changes with the port.
A port belongs to one app on its own machine, and the same port on another machine is a different port.
The same claim sent again leaves the entry unchanged, so a retried `register` succeeds.
The name `hub` belongs to the registry's own route.

## Three states, reported apart

Each entry carries three states, because each can fail without the others.

| State | Values | What sets it |
| --- | --- | --- |
| Owner | alive, ended, expired, unknown | Whether the owner process runs, or the entry's `--ttl` has passed |
| Route | up, down, unknown | Whether frpc reports the app's proxy as running |
| Health | healthy, unhealthy, unknown | Whether the app answers an HTTP request on its port with a status below 500 |

An agent reports every 5 seconds.
A machine that has not reported for 15 seconds shows `unknown` in all three states, since its last report may no longer hold.

## Cleanup when an owner ends

The agent checks each owner process on every report.
When the owner has ended or the entry has expired, the agent removes the entry from the registry first, conditional on the machine and the owner pid, and then removes the route from frpc.
A name the registry now holds for a different owner is kept, and its route is left alone.
A route that is already gone counts as removed, so a cleanup that stops halfway finishes on the next report.
While a machine cannot reach the registry, its entries show `unknown`, and its cleanup runs once the link is back.
The agent also removes a route it made whose app the registry no longer lists, such as after `local-apps remove` on another machine.
It marks the routes it makes with frp metadata, so it never removes a route a person made by hand.

## Related topics

- [Set up the gateway](set-up-the-gateway.md)
- [README](../README.md)
