#!/usr/bin/env bash
# Restore the SQLite database from Litestream replica.
# Usage: bash scripts/litestream-restore.sh [target-path]

set -euo pipefail

TARGET="${1:-./data/restored.db}"

if [ -z "${LITESTREAM_REPLICA_BUCKET:-}" ]; then
  echo "Error: LITESTREAM_REPLICA_BUCKET not set"
  exit 1
fi

docker run --rm \
  -v "$(pwd)/litestream.yml:/etc/litestream.yml" \
  -v "$(dirname "$TARGET"):/restore" \
  -e DATABASE_PATH="/restore/$(basename "$TARGET")" \
  -e LITESTREAM_ACCESS_KEY_ID \
  -e LITESTREAM_SECRET_ACCESS_KEY \
  -e LITESTREAM_REPLICA_BUCKET \
  -e LITESTREAM_REPLICA_PATH="${LITESTREAM_REPLICA_PATH:-db}" \
  -e LITESTREAM_REPLICA_ENDPOINT \
  -e LITESTREAM_REPLICA_REGION="${LITESTREAM_REPLICA_REGION:-us-east-1}" \
  litestream/litestream restore -o "/restore/$(basename "$TARGET")" \
  "s3://${LITESTREAM_REPLICA_BUCKET}/${LITESTREAM_REPLICA_PATH:-db}"

echo "Restored to: $TARGET"
