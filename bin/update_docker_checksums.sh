#!/bin/bash
# Updates SHA256 checksums for external scripts in Dockerfiles
# that don't have apt repositories available.
#
# Currently manages:
# - SDKMAN (sql/Dockerfile)
#
# Usage: ./bin/update_docker_checksums.sh [--apply]
#   Without --apply: shows current and new checksums (dry-run)
#   With --apply: updates the Dockerfiles in place

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

apply=false
if [[ "${1:-}" == "--apply" ]]; then
    apply=true
fi

echo "Fetching SDKMAN install script checksum..."
SDKMAN_NEW=$(curl -sL "https://get.sdkman.io?rcupdate=false" | sha256sum | cut -d' ' -f1)
SDKMAN_CURRENT=$(grep -oP 'ARG SDKMAN_CHECKSUM=\K[a-f0-9]+' "$ROOT_DIR/sql/Dockerfile" || echo "not found")

echo ""
echo "SDKMAN (sql/Dockerfile):"
echo "  Current: ${SDKMAN_CURRENT}"
echo "  New:     ${SDKMAN_NEW}"

if [[ "$SDKMAN_CURRENT" == "$SDKMAN_NEW" ]]; then
    echo "  Status:  up to date"
else
    echo "  Status:  NEEDS UPDATE"
    if $apply; then
        sed -i "s/^ARG SDKMAN_CHECKSUM=.*/ARG SDKMAN_CHECKSUM=${SDKMAN_NEW}/" "$ROOT_DIR/sql/Dockerfile"
        echo "  Updated sql/Dockerfile"
    else
        echo "  Run with --apply to update"
    fi
fi
