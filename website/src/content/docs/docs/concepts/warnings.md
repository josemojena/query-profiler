---
title: Warnings
description: The rules behind N+1, slow and duplicate warnings, and the time in the database.
---

Warnings are computed once, when a request's profile closes. Transaction control statements
(`BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`…) never count.

| Warning       | When                                                                  |
| ------------- | --------------------------------------------------------------------- |
| **N+1**       | 5 or more statements with the same shape in one request               |
| **Duplicate** | The same SQL with the same parameters more than once                  |
| **Slow**      | A statement that took 100 ms or more                                  |
| **Truncated** | The request went over 1000 statements, and the rest were not recorded |

## The shape of a statement

To tell that two statements are "the same query with other values", each one is normalized: comments
are removed, string literals, `$1` placeholders and numbers become `?`, and an `IN (?, ?, ?)` list
becomes `(?)`. The result is hashed into a fingerprint.

```sql
SELECT COUNT(*) FROM "Post" WHERE "authorId" = $1 LIMIT 1
SELECT COUNT(*) FROM "Post" WHERE "authorId" = 42 LIMIT 1
-- both: SELECT COUNT(*) FROM "Post" WHERE "authorId" = ? LIMIT ?
```

## Time in the database

When queries run in parallel, adding up their durations says more than the database did. The
**in DB** figure joins overlapping intervals and counts each stretch once: the time the database was
actually busy.

Durations are measured from Node, from sending a statement to its answer: they include the network
and any wait for a pooled connection.
