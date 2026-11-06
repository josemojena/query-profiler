import { shownPath } from "./format.js";
import type { Profile, ProfileKind } from "./profile.js";
import { endProfile, startProfile, type ActiveProfile } from "./recorder.js";
import { state } from "./state.js";

const IDLE_MS = 200;

/** Where the queries made outside any request go. */
export interface Outside {
  /** The profile they go to now, opened if none is. */
  profile(): ActiveProfile | undefined;
  /** The process serves now (it listens, or runs its first task): what ran before was its startup. */
  serve(): void;
}

export interface OutsideOptions {
  /** The file the process runs: until it serves, everything it does is one profile with this name. */
  script?: string;
  framework: Profile["framework"];
  /** Called with each profile it opens. */
  onOpen?: (active: ActiveProfile) => void;
}

export interface OutsideRecorder extends Outside {
  /** The script's profile, while it is open. */
  readonly script: ActiveProfile | undefined;
  /** Closes the open profile, as the process ends; returns it if it recorded anything. */
  close(): Profile | undefined;
  /** Stops recording what runs outside requests. */
  stop(): void;
}

/**
 * Records the queries made outside any request: a script's run as one profile, until the process
 * serves; from then on, in bursts that end once nothing has run for IDLE_MS. Without a script, the
 * process serves from the start.
 */
export function profileOutside(options: OutsideOptions): OutsideRecorder {
  let serving = options.script === undefined;
  let open: ActiveProfile | undefined;
  let timer: NodeJS.Timeout | undefined;

  const start = (kind: ProfileKind, url: string) => {
    const active = startProfile({ method: "", url, kind }, options.framework);
    options.onOpen?.(active);
    return active;
  };

  const close = (): Profile | undefined => {
    clearTimeout(timer);
    const active = open;
    open = undefined;
    if (!active || active.closed) return undefined;
    if (!active.profile.queries.length && !active.profile.operations.length) {
      active.closed = true;
      return undefined;
    }
    if (active.profile.kind === "background") active.profile.request.url = firstLine(active);
    return endProfile(active);
  };

  // A burst lasts while something asks for it, or while a query it started still runs.
  const settle = () => {
    clearTimeout(timer);
    timer = setTimeout(() => (open && running(open) ? settle() : close()), IDLE_MS);
    timer.unref();
  };

  const recorder: OutsideRecorder = {
    get script() {
      return serving ? undefined : open;
    },
    profile() {
      if (!open || open.closed)
        open = serving ? start("background", "") : start("script", options.script ?? "");
      if (serving) settle();
      return open;
    },
    serve() {
      if (serving) return;
      serving = true;
      if (open) open.profile.kind = "startup";
      close();
    },
    close,
    stop() {
      close();
      if (state().outside === recorder) state().outside = undefined;
    },
  };
  state().outside = recorder;
  return recorder;
}

/** The process serves now: what ran outside requests before was its startup. */
export function serveOutside(): void {
  state().outside?.serve();
}

const running = ({ profile }: ActiveProfile) =>
  [...profile.operations, ...profile.queries].some((record) => record.durationMs === undefined);

/** Where the app started a burst: the line of its first operation, or of its first query. */
function firstLine({ profile }: ActiveProfile): string {
  const frame = [...profile.operations, ...profile.queries].find((record) => record.origin?.length)
    ?.origin?.[0];
  return frame ? `${shownPath(frame.file)}:${frame.line}` : "";
}
