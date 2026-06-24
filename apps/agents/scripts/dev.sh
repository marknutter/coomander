#!/bin/sh
# Dev launcher for the agents Worker.
#
# wrangler hard-errors when a --env-file doesn't exist, and which env files
# exist varies by context: the template repo uses apps/web/.env, scaffolded
# projects (coomander-create skill / CLI) generate apps/web/.env.local, and
# .dev.vars only exists once the operator creates it. Build the flag list
# from whichever files are actually present so `npm run dev` (and the Docker
# CMD that invokes it) works in all three contexts.
set -e

ARGS="--persist-to .wrangler/state"
if [ "${COOMANDER_AGENTS_LOCAL_ONLY:-}" = "true" ]; then
  ARGS="--local $ARGS"
fi
# Default port 8788 (what Caddy's /agents/* route targets) unless the caller
# passes their own --port.
case " $* " in
  *" --port"*) ;;
  *) ARGS="--port 8788 $ARGS" ;;
esac
for f in ../web/.env ../web/.env.local .dev.vars; do
  if [ -f "$f" ]; then
    ARGS="$ARGS --env-file $f"
  fi
done

# shellcheck disable=SC2086
exec npx wrangler dev $ARGS "$@"
