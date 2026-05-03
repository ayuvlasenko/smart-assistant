# Prometheus Metrics Endpoint Design

## Context

The server is a Fastify 5 application in `apps/server` using autoloaded
plugins and routes. Public Kubernetes exposure is controlled by the Helm
Traefik `IngressRoute`, which currently routes only selected `/api` and
`/files` traffic to the server service.

The first metrics step is to expose Node.js default metrics with
`prom-client` and make them available for in-cluster scraping. Public access
must remain controlled only by Kubernetes ingress configuration, not by
application-level IP or auth checks.

## Goals

- Add `prom-client` to the server workspace.
- Collect default Node.js and process metrics with `collectDefaultMetrics`.
- Expose metrics from `GET /metrics` in Prometheus text format.
- Keep `/metrics` out of the public Traefik ingress.
- Leave a clear extension point for custom application metrics.

## Non-Goals

- Do not add custom metrics in this change.
- Do not add application-level IP allowlists, authentication, or secrets for
  `/metrics`.
- Do not add a public ingress route for `/metrics`.
- Do not create Grafana dashboards in this repository.

## Architecture

Add an app plugin dedicated to metrics. The plugin will create a
`prom-client` `Registry`, call `collectDefaultMetrics({ register })`, and
decorate Fastify with a small metrics service. The service will expose the
registry content type and an async method that returns `await registry.metrics()`.

Add a top-level route at `GET /metrics`. The route will get the metrics service
through `fastify.getDecorator<T>()`, set the response `Content-Type` from the
service, and return the metrics string directly.

The Helm ingress will remain unchanged. The existing public Traefik rules do
not match `/metrics`, so public traffic through the configured domain will not
reach the endpoint. In-cluster Prometheus or Grafana Agent configuration can
scrape the Kubernetes service directly.

## Data Flow

1. Fastify autoload registers external plugins, then app plugins, then routes.
2. The metrics app plugin initializes a private `Registry` and registers
   default metrics collectors on that registry.
3. A Prometheus-compatible scraper sends `GET /metrics` to the server service
   inside the cluster.
4. The route awaits `registry.metrics()`.
5. The route responds with the registry content type and Prometheus exposition
   text.

## Error Handling

The route will use normal Fastify error handling. If `registry.metrics()` ever
throws, the existing application error handler will log the failure and return
the standard 500 response. No special error shape is needed for Prometheus
scrapes at this stage.

## Testing

Add focused tests near the route and plugin:

- Assert that `GET /metrics` returns 200 with the registry content type and
  includes a known default metric such as `process_cpu_user_seconds_total`.
- Assert that registering the app in tests does not throw duplicate metric
  registration errors when multiple Fastify instances are created in one Node
  process.
- Assert that no application-level public-IP guard exists for `/metrics`; public
  exposure is intentionally left to ingress.

Verification after implementation should include server formatting, linting,
and typechecking:

- `npm run format -w server`
- `npm run lint -w server`
- `npm run typecheck -w server`

## Future Extensions

Custom metrics can be added later by registering counters, gauges, histograms,
or summaries against the same registry. The existing `/metrics` route will then
expose default and custom metrics together without changing the route contract.
