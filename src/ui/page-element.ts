import type { Profile, ProfileListItem, Stats } from "../core/index.js";
import type { Editor } from "./format.js";
import type { DetailTab } from "./detail.js";
import { runnableSql } from "./format.js";
import { emptyAnalysis, loadFindings, openExplain, planAction, type Where } from "./analysis.js";
import { queryRows } from "./detail.js";
import { clearAll, getJson } from "./http.js";
import { followProfiles, mergeProfiles } from "./live.js";
import { renderList, renderPage, type PageState } from "./page-view.js";
import { emptySession, sessionAction } from "./session.js";
import { formatSql } from "./sql.js";
import { pageStyles } from "./styles.js";
import { choiceOf, chooseTheme, initialTheme } from "./theme.js";

const LIMIT = 100;

/** What the page opens on: the newest page, script or task, not work between requests, which may run every second. */
const newest = (list: ProfileListItem[]) => {
  const roots = list.filter((item) => !item.parentToken);
  return roots.find((item) => item.kind !== "background") ?? roots[0];
};

/** The profiler's own page: every request on the left, the one picked on the right, or the stats. */
export class ProfilerPage extends HTMLElement {
  #root = this.attachShadow({ mode: "open" });
  #stopFollowing?: () => void;
  #state: PageState = {
    base: "/_profiler",
    root: "",
    editor: "vscode",
    expanded: new Set(),
    analysis: emptyAnalysis(),
    session: emptySession(),
    list: [],
    filter: "",
    view: "requests",
    tab: "queries",
    theme: "dark",
  };

  connectedCallback() {
    this.#state.base = this.dataset.base ?? this.#state.base;
    this.#state.editor = (this.dataset.editor as Editor | undefined) ?? this.#state.editor;
    this.#state.theme = initialTheme(this);
    this.dataset.theme = this.#state.theme;
    this.#root.addEventListener("click", this.#onClick);
    this.#root.addEventListener("input", this.#onInput);
    addEventListener("popstate", this.#onPopState);
    void this.#load();
  }

  disconnectedCallback() {
    this.#stopFollowing?.();
    removeEventListener("popstate", this.#onPopState);
  }

  async #load() {
    const { base } = this.#state;
    const [meta, list] = await Promise.all([
      getJson<{ root: string }>(`${base}/api/meta`),
      getJson<ProfileListItem[]>(`${base}/api/profiles?limit=${LIMIT}`),
    ]);
    this.#state.root = meta?.root ?? "";
    this.#state.list = list ?? [];
    this.#stopFollowing = followProfiles(`${base}/api/stream`, {
      onProfile: (item) => this.#addToList([item]),
      // The server's list, not a merge: what was cleared meanwhile must not come back.
      onResume: () =>
        void getJson<ProfileListItem[]>(`${base}/api/profiles?limit=${LIMIT}`).then((items) => {
          this.#state.list = items ?? [];
          this.#renderList();
        }),
      onClear: () => this.#emptied(),
    });
    await this.#route();
  }

  #addToList(items: ProfileListItem[]) {
    this.#state.list = mergeProfiles(items, this.#state.list, LIMIT);
    this.#renderList();
  }

  /** Nothing is stored any more: no list, no profile, and an address that names none. */
  #emptied() {
    const state = this.#state;
    state.list = [];
    state.profile = undefined;
    state.session = emptySession();
    if (state.view === "stats") void this.#route();
    else {
      history.replaceState(null, "", state.base);
      this.#render();
    }
  }

  #onPopState = () => void this.#route();

  /** What the address says: the list (the newest page), a profile, or the stats. */
  async #route() {
    const state = this.#state;
    const path = location.pathname.slice(state.base.length).replace(/^\//, "");
    state.view = path === "stats" ? "stats" : "requests";
    if (state.view === "stats") state.stats = await getJson<Stats>(`${state.base}/api/stats`);
    else {
      const token = /^[0-9a-f]{6}$/.test(path) ? path : newest(state.list)?.token;
      state.profile = token
        ? await getJson<Profile>(`${state.base}/api/profiles/${token}`)
        : undefined;
      state.expanded = new Set();
      const analysis = emptyAnalysis();
      state.analysis = analysis;
      if (state.profile)
        void loadFindings(state.base, state.profile.token).then((findings) => {
          analysis.findings = findings;
          this.#render();
        });
    }
    const opened =
      state.view === "requests" && state.profile && this.#openNamedQuery(state.profile);
    this.#render();
    if (opened)
      this.#root
        .querySelector(`[data-action="expand"][data-id="${opened}"]`)
        ?.scrollIntoView({ block: "center" });
  }

  /** The query the address names (`#q_3`, from the session's analysis): its row, open on Explain plan. */
  #openNamedQuery(profile: Profile): string | undefined {
    const id = /^#(q_\d+)$/.exec(location.hash)?.[1];
    const row =
      id && queryRows(profile).find((each) => each.queries.some((query) => query.id === id));
    const first = row ? row.queries[0]?.id : undefined;
    if (!first) return undefined;
    this.#state.tab = "queries";
    openExplain(this.#state.analysis, this.#where(), first, () => this.#render());
    return first;
  }

  #where(): Where {
    const state = this.#state;
    return {
      base: state.base,
      token: state.profile?.token,
      expand: (id: string, open: boolean) => {
        const expanded = new Set(state.expanded);
        if (open) expanded.add(id);
        else expanded.delete(id);
        state.expanded = expanded;
      },
    };
  }

  #go(href: string) {
    history.pushState(null, "", href);
    void this.#route();
  }

  #onClick = (event: Event) => {
    const target = (event.target as Element).closest<HTMLElement>("[data-action]");
    if (!target) return;
    const state = this.#state;
    if (planAction(target, state.analysis, this.#where(), () => this.#render())) return;
    if (sessionAction(target, state.session, state.base, () => this.#render())) return;
    switch (target.dataset.action) {
      case "go": {
        const mouse = event as MouseEvent;
        if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.button !== 0) return;
        event.preventDefault();
        this.#go(target.getAttribute("href")!);
        return;
      }
      case "tab":
        state.tab = target.dataset.tab as DetailTab;
        break;
      case "clear":
        void clearAll(state.base).then((cleared) => cleared && this.#emptied());
        return;
      case "theme": {
        const theme = choiceOf(target);
        if (theme) {
          chooseTheme(this, theme);
          state.theme = theme;
        }
        break;
      }
      case "expand": {
        const id = target.dataset.id!;
        const expanded = new Set(state.expanded);
        if (!expanded.delete(id)) expanded.add(id);
        state.expanded = expanded;
        break;
      }
      case "copy": {
        const query = state.profile?.queries.find((q) => q.id === target.dataset.id);
        if (query)
          void navigator.clipboard
            .writeText(formatSql(runnableSql(query)))
            .then(() => (target.textContent = "Copied"));
        return;
      }
      default:
        return;
    }
    this.#render();
  };

  // Only the list re-renders while typing, so the filter keeps its focus.
  #onInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.classList.contains("filter")) return;
    this.#state.filter = input.value;
    this.#renderList();
  };

  #renderList() {
    const list = this.#root.querySelector(".list");
    if (list) list.innerHTML = renderList(this.#state);
  }

  #render() {
    this.#root.innerHTML = `<style>${pageStyles}</style>${renderPage(this.#state)}`;
  }
}
