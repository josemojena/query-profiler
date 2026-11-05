import type { Page } from "@playwright/test";

/** Keeps every `EventSource` the page creates, to count the open ones. */
export async function trackStreams(page: Page) {
  await page.addInitScript(() => {
    const streams: EventSource[] = [];
    const slot = window as unknown as { streams: EventSource[] };
    slot.streams = streams;
    window.EventSource = class extends EventSource {
      constructor(...args: ConstructorParameters<typeof EventSource>) {
        super(...args);
        streams.push(this);
      }
    };
  });
}

export const openStreams = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { streams: EventSource[] }).streams.filter(
        (stream) => stream.readyState !== EventSource.CLOSED,
      ).length,
  );

// Headless Chromium keeps every page visible; this is what the browser does when the tab goes to the background.
export async function setVisibility(page: Page, state: "hidden" | "visible") {
  await page.evaluate((state) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => state === "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}
