#!/bin/sh
set -eu
project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$project_dir"

umask 077
mkdir -p data runtime private backups
if [ ! -e .env ]; then
  cp .env.example .env
  printf '%s\n' 'Created .env'
fi
if [ ! -e private/model.env ]; then
  cp private.example.env private/model.env
  printf '%s\n' 'Created private/model.env'
fi
printf '%s\n' 'Setup ready. Existing settings were preserved.'
printf '%s\n' 'For AI features, edit private/model.env with your own endpoint, model ID and API key.'
