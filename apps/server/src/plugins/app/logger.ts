import { requestContext } from "@fastify/request-context";
import { FastifyBaseLogger, FastifyInstance } from "fastify";
import fp from "fastify-plugin";

interface LoggerBindings {
    [key: string]: unknown;
}

type LoggerChildOptions = Parameters<FastifyBaseLogger["child"]>[1];

interface ChildConfig {
    bindings: LoggerBindings;
    options?: LoggerChildOptions;
}

export class AppLogger implements FastifyBaseLogger {
    // Request loggers are per-request objects. WeakMap lets cached child
    // loggers disappear when the underlying request logger is garbage-collected.
    private readonly childCache = new WeakMap<
        FastifyBaseLogger,
        FastifyBaseLogger
    >();

    constructor(
        private readonly fallback: FastifyBaseLogger,
        private readonly parent?: AppLogger,
        private readonly childConfig?: ChildConfig,
    ) {}

    get level() {
        return this.currentLogger.level;
    }

    private get currentLogger(): FastifyBaseLogger {
        const parentLogger = this.parent
            ? this.parent.currentLogger
            : (requestContext.get("log") ?? this.fallback);

        if (!this.childConfig) {
            return parentLogger;
        }

        const cachedLogger = this.childCache.get(parentLogger);
        if (cachedLogger) {
            return cachedLogger;
        }

        const childLogger = parentLogger.child(
            this.childConfig.bindings,
            this.childConfig.options,
        );

        this.childCache.set(parentLogger, childLogger);

        return childLogger;
    }

    set level(level: string) {
        this.currentLogger.level = level;
    }

    child(bindings: LoggerBindings, options?: LoggerChildOptions) {
        return new AppLogger(this.fallback, this, { bindings, options });
    }

    debug(...args: Parameters<FastifyBaseLogger["debug"]>) {
        this.currentLogger.debug(...args);
    }

    error(...args: Parameters<FastifyBaseLogger["error"]>) {
        this.currentLogger.error(...args);
    }

    fatal(...args: Parameters<FastifyBaseLogger["fatal"]>) {
        this.currentLogger.fatal(...args);
    }

    info(...args: Parameters<FastifyBaseLogger["info"]>) {
        this.currentLogger.info(...args);
    }

    silent(...args: Parameters<FastifyBaseLogger["silent"]>) {
        this.currentLogger.silent(...args);
    }

    trace(...args: Parameters<FastifyBaseLogger["trace"]>) {
        this.currentLogger.trace(...args);
    }

    warn(...args: Parameters<FastifyBaseLogger["warn"]>) {
        this.currentLogger.warn(...args);
    }
}

export default fp(
    async function appLoggerPlugin(fastify: FastifyInstance) {
        fastify.decorate("appLogger", new AppLogger(fastify.log));
    },
    {
        name: "app-logger",
        dependencies: ["@fastify/request-context"],
    },
);
