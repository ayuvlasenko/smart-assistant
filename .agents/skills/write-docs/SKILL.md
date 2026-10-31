---
name: write-docs
description: How this repository documents itself — what belongs in AGENTS.md, in a README.md and in neither, and how to check a doc against the code. Use it for any work on AGENTS.md or on any README.md in the repo — writing, updating, shortening, restructuring, reviewing a line, or deciding where a rule or a fact should live. Use it also whenever a code change makes something a doc describes untrue, such as a mechanism, an API, stored data, a limit or a rule, even if nobody mentioned the docs. Not for code comments, commit messages, PR text or docs/backlog items.
---

# Write docs

The repository has two kinds of developer documentation, and they have different readers.

| File                                             | Reader                                                             | Holds                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------- |
| `AGENTS.md`                                      | An agent. It loads into every session, so every line costs context | Commands, rules and gotchas                              |
| `apps/server/src/plugins/app/<domain>/README.md` | A developer or an agent who works in the domain                    | How to use the domain, how its mechanisms work, and why. |

Links go one way: `AGENTS.md` points to a README section, and a README never points to `AGENTS.md`. A developer reads the README to learn the code; sending the developer to an agent instruction file mixes the two readers and splits one topic over two files that drift apart.

Write all documentation in English, also when the conversation is in another language. `docs/backlog/` items belong to the `workflow:backlog` skill.

## AGENTS.md

Agents follow the file closely, and it costs tokens and time in every session. Studies of context files find that they mostly make agents faster and cheaper, help when they state non-standard practices, and do not help when they give an overview of the repository. So a line earns its place only when it changes what an agent does. Test every line: "Would an agent make a mistake without it, and would the tests miss that mistake?" Keep the line only when both answers are yes.

- Keep: commands, the check before a commit, the commit convention, project rules that differ from common defaults, architecture decisions, environment gotchas, and short "must" and "never" rules whose violation passes the tests but breaks behavior.
- Move to a README: how a mechanism works, API walk-throughs, examples, the reasons behind a rule, and rules that matter only inside one domain. Leave a one-line pointer to the README section in their place.
- Shorten to one line: a rule that a tool enforces. Name the tool, such as `erasableSyntaxOnly` or `local/file-layout`, so the agent can connect the error to the rule.
- Drop: what the code or the types already say, such as what a module contains, what it imports or which file does what. An agent reads the code anyway, and such a fact goes stale without an error: the next change makes it a lie that the agent then trusts.

Write a line as a rule, not as a description: "Register a command through `TelegramRouter`", not "The router holds the commands". When a rule needs a fact to make sense, keep the fact short and check it against the code like a README claim.

Keep the instructions in the root `AGENTS.md` and in READMEs. Do not add a nested `AGENTS.md` in a subdirectory: Claude Code reads one when it opens a file in that directory, but Codex builds its instructions once at start, from the repository root down to its working directory, and a session or a review started at the root never reads a deeper file. A rule in a nested file would reach one agent and not the other. The root also counts toward Codex's limit of 32 KiB of instructions, so keep it well below that.

## A domain README

A reader comes to a README with one of two questions: "How do I use this?" or "Why does it work this way?". Order the sections from the first question to the second:

1. **Intro.** One paragraph: what the directory owns and how other domains use it. State a dependency rule, such as "never imports a feature domain", only when a tool enforces it, and name the tool. An unchecked statement about imports is the first sentence to go wrong.
2. **Constraints.** The limits of the external system that shape the design, such as the Bot API limits in `telegram/README.md`. Most of the code exists because of them, and a reader who knows them understands the rest faster.
3. **How to use it.** The public API for another domain, with one complete example taken from real code. Rules of use go here, not in `AGENTS.md`.
4. **Mechanisms.** One section per mechanism, in the shape below.
5. **Files.** A table: file, what it owns, and a link to the section that explains it.

Write each mechanism in this shape:

- **Problem.** What breaks without the mechanism. Name the concrete limit or race. A reader who changes the code must know what to keep safe.
- **Idea.** The solution in one or two sentences.
- **Data.** What it stores and where, with a real example: a Valkey key, a record, a document. Data is the fastest way to understand a mechanism.
- **Walk-through.** Numbered steps of one concrete case, in the order they happen.
- **Edge cases.** Failures, expiry, deploys, concurrency, and what the user sees.

Skip a part that has nothing to say. Use a Mermaid diagram for a flow with branches or several participants, not for a list.

`telegram/README.md` is the reference for every part above.

A domain without a README gets one when it has a mechanism that the code does not explain by itself: state across requests, a race, an external limit, an event other domains rely on. A domain with only a repository and plain calls does not need one.

Code outside a domain, such as `apps/server/migrations/` or `deploy/`, keeps its README in its own directory, next to the code it explains. Use the same section order, and add the README to the documentation list in `AGENTS.md`.

## Verify before you commit

Wrong documentation is worse than none: an agent trusts it and writes code against it. So check every claim against the code, in `AGENTS.md` as well as in a README.

1. Read the code of every mechanism you describe. Do not describe behavior from names or from an older README.
2. For every number, key, limit or error text, find the line that sets it.
3. For every statement about structure, such as "X never imports Y" or "every domain does Z", search the code for a counterexample. One hit makes the statement false; fix the statement or drop it.
4. Compile every TypeScript example. Put it in a temporary file under `apps/server/src/`, add stub interfaces for the services it uses, run `pnpm --filter server typecheck`, and delete the file.
5. Check the anchors. Two headings with the same text get `#name` and `#name-1`, so give each heading unique text and check every `(#...)` link.
6. When you move text out of `AGENTS.md`, check that each removed rule is now in a README or in the remaining rules.
7. Run `pnpm format:md` and `pnpm lint:md`.
8. Commit a README change together with the code change it describes. Commit a documentation-only change as `docs: ...`.

## Style

- Write short sentences in the present tense and the active voice.
- Use one term for one thing in the whole file.
- Write identifiers, keys, commands and error texts exactly as they are in the code, in backticks.
- No marketing words and no filler.
