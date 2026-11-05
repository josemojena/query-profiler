---
title: The bar
description: The bar at the bottom of every page, and what each tab shows.
---

The bar sits at the bottom of every HTML page in development and adds up the page and the calls it
made: requests, queries, the time the database was busy and warnings. Click it to open:

- **Requests**: the page, and under it every call it made after loading: fetchers, navigations,
  actions, revalidations. Each call is its own profile, tagged with the page's token
  (`X-Debug-Parent`), so it hangs under the page. A client navigation starts a new page.
- **Queries** of the request you pick: N+1 groups collapsed, slow and duplicate queries marked, the
  runnable SQL to copy, and the line to open in your editor.
- **Operations**, **Timeline**, **Warnings** and **Request**.

It updates live, lists recent requests, shrinks to a pill, and links to the
[full profile](/docs/concepts/profiler-page).

## How it gets there without touching your code

The middleware adds a small script before `</body>`. It starts tracking the page's `fetch` calls
right away, before your app hydrates, so calls made on mount are not missed. Once the page has
loaded it adds the bar as a web component, so React's hydration never sees it. Its styles live in
its Shadow DOM and never clash with yours.

The bar at the bottom of the [home page](/) is the real component, on sample data.
