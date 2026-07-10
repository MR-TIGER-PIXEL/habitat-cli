#!/usr/bin/env bash
set -e

echo "Starting..."

mkdir -p backups

if [ -f .habitat/habitat.sqlite ]; then
  cp .habitat/habitat.sqlite \
    "backups/habitat-$(date +%Y%m%d-%H%M%S).sqlite"

  echo "Backed up existing SQLite database."
fi

habitat unregister
habitat register --name "Artemis Ridge"

echo "Complete"
