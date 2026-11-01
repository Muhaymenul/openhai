#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cd "$project_dir"
sh scripts/setup.sh

if ! command -v docker >/dev/null 2>&1; then
  printf '%s\n' 'Install Docker with Docker Compose v2, then retry.' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  printf '%s\n' 'Docker is not ready. Start Docker Desktop or your local Docker engine, then retry.' >&2
  exit 1
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
  *) printf '%s\n' 'Select a local Docker context before starting this application.' >&2; exit 1 ;;
esac

images_ready=1
images=$(docker compose config --images)
for service_image in $images; do
  if ! docker image inspect "$service_image" >/dev/null 2>&1; then
    images_ready=0
  fi
done
if [ "$images_ready" -eq 1 ]; then
  docker compose up -d --no-build
else
  docker compose build --builder default
  docker compose up -d --no-build
fi
web_address=$(docker compose port web 3000)
printf '\nOpen http://%s/workspace\n' "$web_address"
printf '%s\n' 'The web page may take a moment to become ready. View logs with: docker compose logs --tail 50 web paperflow'
