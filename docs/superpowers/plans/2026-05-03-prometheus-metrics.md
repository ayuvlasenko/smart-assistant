# Prometheus Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose default Node.js Prometheus metrics from the Fastify server at `GET /metrics` for in-cluster scraping.

**Architecture:** Add `prom-client` to the server workspace, create a focused metrics app plugin with a private `Registry`, and add a top-level `/metrics` route that reads from the decorated metrics service. Keep public access controlled by the existing Kubernetes ingress by leaving Helm ingress files unchanged, and disable normal request logs for scrape traffic using Fastify `logLevel: "silent"`.

**Tech Stack:** Fastify 5, npm workspaces, TypeScript NodeNext, `prom-client` 15.1.3, Node.js test runner.

---

## File Structure

- Modify: `apps/server/package.json`
  - Adds `prom-client` to server dependencies through `npm install -w server prom-client@15.1.3`.
- Modify: `package-lock.json`
  - Records the installed `prom-client` version and transitive dependencies.
- Create: `apps/server/src/plugins/app/metrics.ts`
  - Owns a private `prom-client` `Registry`.
  - Calls `collectDefaultMetrics({ register })`.
  - Decorates Fastify with a `metrics` service.
  - Exposes a future extension point for custom metrics through the shared registry.
- Create: `apps/server/src/plugins/app/metrics.test.ts`
  - Verifies default metrics are collected.
  - Verifies multiple Fastify apps can register the plugin in one Node process without duplicate metric registration errors.
- Create: `apps/server/src/routes/metrics.ts`
  - Defines `GET /metrics`.
  - Reads the metrics service with `fastify.getDecorator<T>()`.
  - Sets `Content-Type` from the service.
  - Uses `logLevel: "silent"` to suppress scrape request logs.
- Create: `apps/server/src/routes/metrics.test.ts`
  - Verifies the route contract with a fake metrics decorator.
  - Verifies no application-level public-IP guard is present.
  - Verifies normal request logs are suppressed for `/metrics`.
- Do not modify: `deploy/templates/ingress.yaml`, `deploy/values.yaml`
  - Existing public ingress rules remain the only external exposure boundary.

---

### Task 1: Add `prom-client` Dependency

**Files:**
- Modify: `apps/server/package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install the dependency**

Run:

```bash
npm install -w server prom-client@15.1.3
```

Expected: command exits with code 0, `apps/server/package.json` is modified,
and `package-lock.json` is modified. The repository `.npmrc` has
`save-exact=true`, so npm should save the dependency as `15.1.3`.

- [ ] **Step 2: Inspect dependency changes**

Run:

```bash
git diff -- apps/server/package.json package-lock.json
```

Expected: `apps/server/package.json` includes `"prom-client": "15.1.3"` under `dependencies`, and `package-lock.json` includes the resolved `prom-client` package.

- [ ] **Step 3: Commit dependency setup**

Run:

```bash
git add apps/server/package.json package-lock.json
git commit -m "chore: adds prometheus client dependency"
```

Expected: commit succeeds and only dependency files are included.

---

### Task 2: Add `/metrics` Route With a Failing Route Test

**Files:**
- Create: `apps/server/src/routes/metrics.test.ts`
- Create: `apps/server/src/routes/metrics.ts`

- [ ] **Step 1: Write the failing route test**

Create `apps/server/src/routes/metrics.test.ts`:

```typescript
import assert from "node:assert/strict";
import fastifyAutoload from "@fastify/autoload";
import Fastify, { FastifyServerOptions } from "fastify";
import { describe, it, TestContext } from "node:test";
import { requestIdOptions } from "../constants/options.js";
import { createLogCollector } from "../test/log-collector.js";

const prometheusContentType = "text/plain; version=0.0.4; charset=utf-8";
const metricsBody = [
    "# HELP process_cpu_user_seconds_total Total user CPU time spent in seconds.",
    "# TYPE process_cpu_user_seconds_total counter",
    "process_cpu_user_seconds_total 1",
    "",
].join("\n");

const ignoredRoutePattern = /(?:^api\/|\/api\/|\.(?:test|spec)\.(?:js|ts)$)/;

interface MetricsDecorator {
    readonly contentType: string;
    metrics(): Promise<string>;
}

interface BuildOptions {
    logger?: FastifyServerOptions["logger"];
    metrics?: MetricsDecorator;
}

void describe("GET /metrics", () => {
    void it("returns Prometheus metrics with the registry content type", async (t) => {
        const app = await buildMetricsRouteApp(t);

        const response = await app.inject({
            method: "GET",
            url: "/metrics",
        });

        assert.equal(response.statusCode, 200);
        assert.match(
            response.headers["content-type"] as string,
            /^text\/plain; version=0\.0\.4; charset=utf-8/,
        );
        assert.equal(response.body, metricsBody);
    });

    void it("does not add an application-level public address guard", async (t) => {
        const app = await buildMetricsRouteApp(t);

        const response = await app.inject({
            method: "GET",
            url: "/metrics",
            headers: {
                "x-forwarded-for": "203.0.113.10",
            },
        });

        assert.equal(response.statusCode, 200);
        assert.equal(response.body, metricsBody);
    });

    void it("does not write access logs for scrapes", async (t) => {
        const logs = createLogCollector();
        const app = await buildMetricsRouteApp(t, {
            logger: logs.logger,
        });

        const response = await app.inject({
            method: "GET",
            url: "/metrics",
        });
        const accessLogMessages = logs
            .readEntries()
            .map((entry) => entry.msg)
            .filter(
                (message) =>
                    message === "incoming request" ||
                    message === "request completed",
            );

        assert.equal(response.statusCode, 200);
        assert.deepEqual(accessLogMessages, []);
    });
});

async function buildMetricsRouteApp(t: TestContext, opts: BuildOptions = {}) {
    const app = Fastify({
        logger: opts.logger ?? false,
        ...requestIdOptions,
        trustProxy: true,
    });

    app.decorate(
        "metrics",
        opts.metrics ?? {
            contentType: prometheusContentType,
            metrics: async () => metricsBody,
        },
    );

    await app.register(fastifyAutoload, {
        dir: import.meta.dirname,
        ignorePattern: ignoredRoutePattern,
        autoHooks: true,
        cascadeHooks: true,
        routeParams: true,
    });

    await app.ready();
    t.after(() => app.close());

    return app;
}
```

- [ ] **Step 2: Run the route test to verify it fails**

Run:

```bash
npm exec -w server -- node --env-file=.env.test --import tsx --test src/routes/metrics.test.ts
```

Expected: FAIL with `404 !== 200` for `GET /metrics`, because `apps/server/src/routes/metrics.ts` does not exist yet.

- [ ] **Step 3: Add the minimal route implementation**

Create `apps/server/src/routes/metrics.ts`:

```typescript
import { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

interface MetricsService {
    readonly contentType: string;
    metrics(): Promise<string>;
}

const plugin: FastifyPluginAsyncTypebox = async (fastify) => {
    const metrics = fastify.getDecorator<MetricsService>("metrics");

    fastify.get(
        "/metrics",
        {
            logLevel: "silent",
        },
        async (_request, reply) => {
            reply.type(metrics.contentType);

            return metrics.metrics();
        },
    );
};

export default plugin;
```

- [ ] **Step 4: Run the route test to verify it passes**

Run:

```bash
npm exec -w server -- node --env-file=.env.test --import tsx --test src/routes/metrics.test.ts
```

Expected:

```text
pass 3
fail 0
```

Do not commit yet. The full app still needs the real metrics decorator.

---

### Task 3: Add Metrics Plugin With a Private Registry

**Files:**
- Create: `apps/server/src/plugins/app/metrics.test.ts`
- Create: `apps/server/src/plugins/app/metrics.ts`

- [ ] **Step 1: Write the failing plugin test**

Create `apps/server/src/plugins/app/metrics.test.ts`:

```typescript
import assert from "node:assert/strict";
import Fastify from "fastify";
import { describe, it, TestContext } from "node:test";
import metricsPlugin, { MetricsService } from "./metrics.js";

const prometheusContentType = "text/plain; version=0.0.4; charset=utf-8";

void describe("metrics plugin", () => {
    void it("collects default metrics in Prometheus text format", async (t) => {
        const app = await buildMetricsPluginApp(t);
        const metrics = app.getDecorator<MetricsService>("metrics");
        const body = await metrics.metrics();

        assert.equal(metrics.contentType, prometheusContentType);
        assert.match(body, /^# HELP process_cpu_user_seconds_total/m);
        assert.match(body, /^# TYPE process_cpu_user_seconds_total counter/m);
    });

    void it("can be registered on multiple Fastify apps in one process", async (t) => {
        const firstApp = await buildMetricsPluginApp(t);
        const secondApp = await buildMetricsPluginApp(t);
        const firstMetrics = firstApp.getDecorator<MetricsService>("metrics");
        const secondMetrics = secondApp.getDecorator<MetricsService>("metrics");

        assert.match(
            await firstMetrics.metrics(),
            /^# HELP process_cpu_user_seconds_total/m,
        );
        assert.match(
            await secondMetrics.metrics(),
            /^# HELP process_cpu_user_seconds_total/m,
        );
    });
});

async function buildMetricsPluginApp(t: TestContext) {
    const app = Fastify({ logger: false });

    await app.register(metricsPlugin);
    await app.ready();
    t.after(() => app.close());

    return app;
}
```

- [ ] **Step 2: Run the plugin test to verify it fails**

Run:

```bash
npm exec -w server -- node --env-file=.env.test --import tsx --test src/plugins/app/metrics.test.ts
```

Expected: FAIL with module resolution error for `./metrics.js`, because the plugin does not exist yet.

- [ ] **Step 3: Add the metrics plugin implementation**

Create `apps/server/src/plugins/app/metrics.ts`:

```typescript
import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import {
    collectDefaultMetrics,
    Registry,
    type RegistryContentType,
} from "prom-client";

export class MetricsService {
    private readonly registry = new Registry();

    constructor() {
        collectDefaultMetrics({ register: this.registry });
    }

    get contentType(): RegistryContentType {
        return this.registry.contentType;
    }

    async metrics(): Promise<string> {
        return this.registry.metrics();
    }
}

export default fp(
    async function metricsPlugin(fastify: FastifyInstance) {
        fastify.decorate("metrics", new MetricsService());
    },
    {
        name: "metrics",
    },
);
```

- [ ] **Step 4: Run the plugin test to verify it passes**

Run:

```bash
npm exec -w server -- node --env-file=.env.test --import tsx --test src/plugins/app/metrics.test.ts
```

Expected:

```text
pass 2
fail 0
```

- [ ] **Step 5: Run the route and plugin tests together**

Run:

```bash
npm exec -w server -- node --env-file=.env.test --import tsx --test src/routes/metrics.test.ts src/plugins/app/metrics.test.ts
```

Expected:

```text
pass 5
fail 0
```

- [ ] **Step 6: Commit the metrics route and plugin**

Run:

```bash
git add apps/server/src/routes/metrics.test.ts apps/server/src/routes/metrics.ts apps/server/src/plugins/app/metrics.test.ts apps/server/src/plugins/app/metrics.ts
git commit -m "feat: exposes prometheus default metrics"
```

Expected: commit succeeds with the route, plugin, and their tests.

---

### Task 4: Verify Formatting, Types, Linting, and Ingress Boundary

**Files:**
- Modify only if formatting changes: files changed in Tasks 1-3.
- Do not modify: `deploy/templates/ingress.yaml`, `deploy/values.yaml`

- [ ] **Step 1: Format the server workspace**

Run:

```bash
npm run format -w server
```

Expected: command exits with code 0. If it rewrites files, inspect the diff before committing.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint -w server
```

Expected: command exits with code 0.

- [ ] **Step 3: Run TypeScript checks**

Run:

```bash
npm run typecheck -w server
```

Expected: command exits with code 0.

- [ ] **Step 4: Re-run focused metrics tests**

Run:

```bash
npm exec -w server -- node --env-file=.env.test --import tsx --test src/routes/metrics.test.ts src/plugins/app/metrics.test.ts
```

Expected:

```text
pass 5
fail 0
```

- [ ] **Step 5: Verify the public ingress files were not changed**

Run:

```bash
git diff --exit-code -- deploy/templates/ingress.yaml deploy/values.yaml
```

Expected: no output and exit code 0.

- [ ] **Step 6: Commit verification or formatting changes**

If `npm run format -w server` changed files, run:

```bash
git add apps/server/src/routes/metrics.test.ts apps/server/src/routes/metrics.ts apps/server/src/plugins/app/metrics.test.ts apps/server/src/plugins/app/metrics.ts
git commit -m "style: formats prometheus metrics endpoint"
```

Expected: commit succeeds only if there are formatting changes. If there are no formatting changes, skip this commit step.

---

### Task 5: Final Review

**Files:**
- Review: all files changed by Tasks 1-4.

- [ ] **Step 1: Inspect current branch and commits**

Run:

```bash
git branch --show-current
git log --oneline -5
git status --short
```

Expected:

```text
feature/prometheus-metrics
```

`git status --short` should be empty.

- [ ] **Step 2: Inspect the final diff from the base design branch**

Run:

```bash
git diff ce1e84e HEAD --stat
```

Expected: changes include the Superpowers docs, `prom-client` dependency files, metrics route/plugin files, and metrics tests. No Helm ingress files should appear.

- [ ] **Step 3: Prepare completion summary**

Report:

```text
Implemented GET /metrics with prom-client default metrics, silent scrape logging, and ingress-only public exposure.
Verified with:
- npm run format -w server
- npm run lint -w server
- npm run typecheck -w server
- npm exec -w server -- node --env-file=.env.test --import tsx --test src/routes/metrics.test.ts src/plugins/app/metrics.test.ts
```
