export interface ParseNumberOptions {
    maxIntegerDigits?: number;
    maxFractionDigits?: number;
}

export function parseNumber(
    raw: string,
    { maxIntegerDigits = 12, maxFractionDigits = 2 }: ParseNumberOptions = {},
): number | undefined {
    const normalized = raw.replace(/\s/g, "").replace(",", ".");
    const fractionPattern =
        maxFractionDigits > 0 ? `(\\.\\d{1,${maxFractionDigits}})?` : "";
    const pattern = new RegExp(
        `^[+-]?\\d{1,${maxIntegerDigits}}${fractionPattern}$`,
    );

    return pattern.test(normalized) ? Number(normalized) : undefined;
}

export function parseDate(raw: string, today: string): string | undefined {
    const normalized = raw.replace(/\s/g, "");
    const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(normalized);
    const dottedMatch = /^(\d{1,2})(?:[./](\d{1,2})(?:[./](\d{4}))?)?$/.exec(
        normalized,
    );

    if (isoMatch) {
        return buildDate(isoMatch[1], isoMatch[2], isoMatch[3]);
    }

    if (dottedMatch) {
        return buildDate(
            dottedMatch[3] ?? today.slice(0, 4),
            dottedMatch[2] ?? today.slice(5, 7),
            dottedMatch[1],
        );
    }
}

export function formatDate(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const readPart = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value;

    return `${readPart("year")}-${readPart("month")}-${readPart("day")}`;
}

export function addDays(date: string, days: number): string {
    const result = new Date(`${date}T00:00:00Z`);

    result.setUTCDate(result.getUTCDate() + days);

    return result.toISOString().slice(0, 10);
}

export function isTimeZone(timeZone: string): boolean {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone });
        return true;
    } catch {
        return false;
    }
}

function buildDate(
    year: string | undefined,
    month: string | undefined,
    day: string | undefined,
): string | undefined {
    const date = new Date(
        Date.UTC(Number(year), Number(month) - 1, Number(day)),
    );

    if (
        date.getUTCFullYear() !== Number(year) ||
        date.getUTCMonth() !== Number(month) - 1 ||
        date.getUTCDate() !== Number(day)
    ) {
        return;
    }

    return date.toISOString().slice(0, 10);
}
