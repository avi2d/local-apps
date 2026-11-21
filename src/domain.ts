import { Result, Schema } from "effect";

export const AppName = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]{0,39}$/, {
    message: "a name is 1 to 40 lowercase letters, digits or hyphens, starting with a letter",
  }),
);

export const hubName = "hub";

export class Registration extends Schema.Class<Registration>("local-apps/Registration")({
  name: AppName,
  machine: Schema.NonEmptyString,
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 })),
  ownerPid: Schema.Int.check(Schema.isGreaterThan(0)),
  expiresAt: Schema.optionalKey(Schema.Finite),
}) {}

const OwnerSeen = Schema.Literals(["alive", "ended"]);
const RouteSeen = Schema.Literals(["up", "down"]);
const HealthSeen = Schema.Literals(["healthy", "unhealthy"]);

export class AppReport extends Schema.Class<AppReport>("local-apps/AppReport")({
  name: AppName,
  owner: OwnerSeen,
  route: RouteSeen,
  health: HealthSeen,
}) {}

export class MachineReport extends Schema.Class<MachineReport>("local-apps/MachineReport")({
  apps: Schema.Array(AppReport),
}) {}

const OwnerState = Schema.Literals(["alive", "ended", "expired", "unknown"]);
const RouteState = Schema.Literals(["up", "down", "unknown"]);
const HealthState = Schema.Literals(["healthy", "unhealthy", "unknown"]);

export class AppView extends Schema.Class<AppView>("local-apps/AppView")({
  name: AppName,
  machine: Schema.String,
  port: Schema.Int,
  ownerPid: Schema.Int,
  owner: OwnerState,
  route: RouteState,
  health: HealthState,
  url: Schema.String,
  expiresAt: Schema.optionalKey(Schema.Finite),
}) {}

export class AppList extends Schema.Class<AppList>("local-apps/AppList")({
  apps: Schema.Array(AppView),
}) {}

export interface MachineSeen {
  readonly at: number;
  readonly apps: ReadonlyMap<string, AppReport>;
}

export const isExpired = (registration: Registration, now: number): boolean =>
  registration.expiresAt !== undefined && now >= registration.expiresAt;

export const viewOf = (
  registration: Registration,
  seen: MachineSeen | undefined,
  options: { readonly now: number; readonly staleAfterMs: number; readonly url: string },
): AppView => {
  const fresh = seen !== undefined && options.now - seen.at <= options.staleAfterMs;
  const report = fresh ? seen.apps.get(registration.name) : undefined;
  return new AppView({
    name: registration.name,
    machine: registration.machine,
    port: registration.port,
    ownerPid: registration.ownerPid,
    owner: isExpired(registration, options.now) ? "expired" : (report?.owner ?? "unknown"),
    route: report?.route ?? "unknown",
    health: report?.health ?? "unknown",
    url: options.url,
    ...(registration.expiresAt === undefined ? {} : { expiresAt: registration.expiresAt }),
  });
};

export class Refused extends Schema.TaggedError<Refused>()("Refused", {
  reason: Schema.String,
}) {}

const sameClaim = (a: Registration, b: Registration): boolean =>
  a.machine === b.machine && a.port === b.port && a.ownerPid === b.ownerPid;

export const claim = (
  current: ReadonlyArray<Registration>,
  next: Registration,
): Result.Result<"added" | "unchanged", Refused> => {
  if (next.name === hubName) return Result.fail(new Refused({ reason: `the name ${hubName} belongs to the registry` }));
  const named = current.find((entry) => entry.name === next.name);
  if (named !== undefined) {
    return sameClaim(named, next)
      ? Result.succeed("unchanged")
      : Result.fail(new Refused({ reason: `${next.name} is already registered on ${named.machine} port ${named.port}` }));
  }
  const onPort = current.find((entry) => entry.machine === next.machine && entry.port === next.port);
  if (onPort !== undefined) {
    return Result.fail(new Refused({ reason: `port ${next.port} on ${next.machine} is already registered as ${onPort.name}` }));
  }
  return Result.succeed("added");
};

export const appUrl = (gateway: URL, name: string, domain: string): string =>
  `${gateway.protocol}//${name}.${domain}${gateway.port === "" ? "" : `:${gateway.port}`}/`;
