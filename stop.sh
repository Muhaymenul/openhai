#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cd "$project_dir"
if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' 'Docker is unavailable. No application data was changed.'
  exit 0
fi
if ! docker info >/dev/null 2>&1; then
  printf '%s\n' 'Docker is offline. Your documents, notes and settings are preserved.'
  exit 0
fi
if [ -n "${DOCKER_CONTEXT:-}" ]; then
  endpoint=$(docker context inspect "$DOCKER_CONTEXT" --format '{{.Endpoints.docker.Host}}')
elif [ -n "${DOCKER_HOST:-}" ]; then
  endpoint=$DOCKER_HOST
else
  endpoint=$(docker context inspect --format '{{.Endpoints.docker.Host}}')
fi
case "$endpoint" in
  unix:*|npipe:*) ;;
  *) printf '%s\n' 'Select the local Docker context used to start this application.' >&2; exit 1 ;;
esac
docker compose stop
printf '%s\n' 'Stopped. Your documents, notes and settings are preserved.'
