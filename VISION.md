# Vision

Every app running on your machines is in one list that tells the truth about it.
It serves the people and the scripts that start local apps on more than one machine.
It owns the record of which app holds which name and port, and which process owns it.

## The registry decides

- The registry may refuse any claim, the gateway and agents hold no state of their own, and every change waits on reaching the registry.

## The list never guesses

- An unconfirmed state shows as unknown, a stale report never shows as healthy, and the list shows unknown more often than a guessing list would.

## Owner, route and health stay apart

- Each entry reports three separate states, no single combined status replaces them, and a reader reads three columns instead of one.

## Private by default

- Listeners sit on a private interface or loopback behind authentication, nothing faces the public internet, and no app is reachable from outside the private network.

## Cleanup takes only what its owner held

- Cleanup removes the entry and route of an ended owner, never a process or a foreign route, so an orphaned app keeps running unlisted.

## Scope

- Starting, restarting or supervising apps is refused, and the tool that starts an app owns it.
- Public tunnels and exposure to the internet are refused, and a tunnel service built for it owns that.
- Name resolution and certificates are refused, and the private network owns them.

A change aligns when it makes the list more truthful about an app, its owner or its route.
A change should be resisted when it trades a true unknown for a guessed state, or reaches past the private network.
