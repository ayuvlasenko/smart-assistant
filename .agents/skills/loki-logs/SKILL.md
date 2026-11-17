---
name: loki-logs
description: Read the real server logs of smart-assistant, production or a pull request preview, from Loki in the cluster through kubectl. Use it whenever a question is about what the running bot did and not about what the code says — why the bot stayed silent or answered late, what happened with one update, one user or one request, what the last errors were, what a deploy logged, whether a rate limit pause happened, how many lines a message produces. Use it also when the user says "look in Loki", "check the logs", "what do the logs say", or gives a reqId, an updateId, a Telegram id or a user id. Read-only; it needs kubectl access to the cluster.
---

# Loki logs

The cluster ships the output of every pod to Loki. `scripts/query.sh` asks Loki through the Kubernetes API server, so a query needs only `kubectl`: no port-forward, no Grafana login and no token.

## Run a query

Run the script from the repository root:

```bash
.agents/skills/loki-logs/scripts/query.sh '<LogQL>' [--since 1h] [--limit 200] [--instant]
```

It prints the newest lines of the time range, one per row, oldest first. Every line of the server is a JSON object, so pipe it to `jq` and keep only the fields the question needs. `time` is in milliseconds:

```bash
.agents/skills/loki-logs/scripts/query.sh \
    '{service_name="smart-assistant-server-main"} | json | msg="Update handled" | result!="handled"' \
    --since 24h | jq -c '{at: (.time / 1000 | todate), userId, updateType, result, route, refusedRoute}'
```

- `--since` takes `30m`, `6h` or `2d`, and the default is one hour. The bot is quiet for hours, so an empty answer usually means a short range: widen `--since` before you conclude that no such line exists.
- `--limit 1` gives the newest line that matches. Loki returns 5000 lines at most, so narrow the range before you raise the limit.
- `--instant` runs a metric query, such as `count_over_time`. Its range is inside the query, as `[24h]`, and `--since` does not apply. The output is one row per series, the largest value first.
- A refused query prints the reason of Loki, such as a parse error with its column.
- Save a large answer to a file in the scratchpad and query the file with `jq`. Thousands of lines in the conversation push the question out of the context.

## Pick the stream

Loki indexes only the labels, so a query starts with them and filters everything else after `| json`.

| Label          | Values                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `service_name` | `smart-assistant-server-main` is production, `smart-assistant-server-pr-<number>` is a preview                      |
| `namespace`    | `smart-assistant` for every pod of the project                                                                      |
| `app`          | `server`, or `migration` for a migration job                                                                        |
| `level`        | `info`, `warn`, `error`. Lines from before the levels got names have `30`, `40`, `50`: match both, as `"error\|50"` |

- Other projects of the cluster also have a `resource_name="main"`, so never select by `resource_name` alone.
- A migration job is its own stream, `smart-assistant-migration-main` or `smart-assistant-migration-pr-<number>`. Its lines are plain text without a level, such as `MIGRATED UP: …`, so read them without `| json` and without `jq`.
- The previews share the bots of the development database, and a bot answers only the preview that took its webhook last. So check which preview a line comes from before you read it as the behavior of a branch.

## Fields of a line

| Field                                           | Where                                | Meaning                                                                                          |
| ----------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `reqId`                                         | every line of one HTTP request       | Joins `request completed`, `Update handled` and every line between them                          |
| `botId`, `updateId`, `telegramUserId`, `userId` | the lines of the update handler      | The bot, the `update_id` of Telegram, the Telegram id and the id of the user document            |
| `result`, `route`, `refusedRoute`, `durationMs` | `Update handled`, one per update     | How the update ended, what handled it, and the command or deep link whose guard refused the user |
| `scene`, `sceneId`, `button`, `input`           | the lines of a scene                 | The scene, its instance, and the button or the input                                             |
| `req.url`, `res.statusCode`, `responseTime`     | `request completed`, one per request | The request, its status and its time in milliseconds                                             |
| `err.type`, `err.message`, `err.stack`          | an error line                        | The error                                                                                        |
| `module`                                        | the lines of a domain                | The domain that wrote the line, such as `telegram` or `poker`                                    |
| `hostname`                                      | every line                           | The pod                                                                                          |

`| json` turns a nested field into a name with underscores: filter `req.url` as `req_url` and `res.statusCode` as `res_statusCode`.

A pod can run an older version of the server that writes other messages and fields. When a recipe returns nothing, run the last recipe below first: it lists the messages this version writes.

## Recipes

`S` stands for the stream, `{service_name="smart-assistant-server-main"}` for production.

```text
Everything of one request or update     S | json | reqId="<id>"
Everything of one user                  S | json | userId="<id>"            or telegramUserId="<id>"
The newest update                       S | json | msg="Update handled"     with --limit 1
Why the bot stayed silent               S | json | msg="Update handled" | result!="handled"
A command whose guard refused the user  S | json | refusedRoute=~"command:.+"
The errors                              {service_name="smart-assistant-server-main", level=~"error|50"}
The warnings                            {service_name="smart-assistant-server-main", level=~"warn|40"}
Failed requests                         S | json | res_statusCode >= 400
Slow requests                           S | json | msg="request completed" | responseTime > 1000
Slow updates                            S | json | msg="Update handled" | durationMs > 2000
Rate limit pauses                       S | json | msg="Telegram rate limit buckets paused"
Updates sent to other users             S | json | msg=~"Scene update (delivered|published)"
What one bot did                        S | json | botId="<id>"
Lines per message, and which exist      sum by (msg) (count_over_time(S | json [24h]))    with --instant
```

Start from the final line of an update or a request, take its `reqId`, and read the whole request with the first recipe: the lines in between say what the handler did. "Errors" in a question often means more than the level: a `404` is a `request completed` line at `info`, so look at the failed requests and the warnings too.

## When the logs do not answer

A line never holds message text, callback data or a token: the project forbids it, and the logger masks what slips through. So the text a user sent is not in the logs, and looking for it wastes the search. When a question needs a fact that no line carries, say so and propose the log line to add; `AGENTS.md` has the rule for writing one.

The logs of the last minutes are also in `kubectl logs -n smart-assistant deploy/server-main`. Use Loki for a search and for anything older than the pod.
