---
title: Introduction
description: What query-profiler is and what it shows you.
---

**query-profiler is the database profiler for Prisma ORM, in development.** For every request your
app serves, it records what Prisma did in the database and why:

- every **Prisma operation** (`User.findMany`, `Order.create`…) with its arguments and the **line of
  your code** that called it;
- every **SQL statement** Prisma sent for it, with its parameters and duration, including
  transactions, batches and the queries Prisma compacts;
- **N+1**, **slow** and **duplicate** query warnings.

You see it in a **bar at the bottom of your pages**, in a **full profiler page** at `/_profiler`, and
as JSON. It runs only in development and leaves nothing in production builds.

## A quick look

A page that loads users and then counts each user's posts in a loop makes one query, then one more
per user. In the bar that shows up as a single row, `Post.count · 6 times from the same place`,
marked **N+1**, pointing at `app/routes/home.tsx:8`. The fix is one `include`.

The bar at the bottom of the [home page](/) is the real one, running on that sample data.

## Next steps

- [Install it](/docs/installation) and check the requirements.
- Set it up in [React Router](/docs/guides/react-router).
- Learn [how it works](/docs/concepts/how-it-works).
