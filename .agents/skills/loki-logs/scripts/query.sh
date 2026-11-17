#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat >&2 <<'USAGE'
Usage: query.sh '<LogQL>' [--since 1h] [--limit 200] [--instant]

  --since    How far back to look: 30m, 6h, 2d. Default 1h.
  --limit    The most lines to return, 5000 at most. Default 200.
  --instant  Run a metric query, such as count_over_time. Its range is inside
             the query, as [24h]; --since and --limit do not apply.

Prints the newest lines of the range, one per row, oldest first. With --instant
it prints one row per series, the largest value first: the value, a tab, the labels.
USAGE
    exit 2
}

[ $# -ge 1 ] || usage

query="$1"
shift
since="1h"
limit="200"
instant=""

while [ $# -gt 0 ]; do
    case "$1" in
        --since) since="${2:-}"; shift 2 ;;
        --limit) limit="${2:-}"; shift 2 ;;
        --instant) instant="1"; shift ;;
        *) usage ;;
    esac
done

case "$since" in
    *m) seconds=$(( ${since%m} * 60 )) ;;
    *h) seconds=$(( ${since%h} * 3600 )) ;;
    *d) seconds=$(( ${since%d} * 86400 )) ;;
    *) usage ;;
esac

loki="/api/v1/namespaces/monitoring/services/loki:3100/proxy/loki/api/v1"
encoded=$(jq -rn --arg query "$query" '$query | @uri')

ask() {
    local url="$1"

    if ! kubectl get --raw "$url" 2>/dev/null; then
        local detail

        detail=$(kubectl get --raw "$url" -v=8 2>&1 \
            | grep -o '"message": "[^"]*' \
            | tail -1 \
            | sed 's/^"message": "//' || true)
        echo "Loki refused the query: ${detail:-no answer, check kubectl access to the cluster}" >&2
        exit 1
    fi
}

if [ -n "$instant" ]; then
    ask "$loki/query?query=$encoded" \
        | jq -r '.data.result | sort_by(.value[1] | tonumber) | reverse | .[] | [.value[1], (.metric | tojson)] | @tsv'
    exit 0
fi

now=$(date +%s)

ask "$loki/query_range?query=$encoded&start=$(( now - seconds ))000000000&end=${now}000000000&limit=$limit&direction=backward" \
    | jq -r '[.data.result[].values[]] | sort_by(.[0]) | .[][1]'
