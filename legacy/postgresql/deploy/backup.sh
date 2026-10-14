#!/usr/bin/env bash
set -euo pipefail
: "${PGHOST:?Set PostgreSQL backup host}"
: "${PGDATABASE:?Set PostgreSQL backup database}"
: "${PGUSER:?Set PostgreSQL schema-owner backup user}"
: "${PGPASSWORD:?Supply backup password through the secret environment}"
: "${BACKUP_RECIPIENT:?Set the age public recipient key}"
mkdir -p backups
backup_file="backups/dentaflow-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump.age"
temporary_file="$(mktemp backups/.dump.XXXXXX)"
trap 'rm -f -- "$temporary_file"' EXIT
# Requires pg_dump and age. Private age keys belong only to the restore environment.
pg_dump --format=custom --no-owner --no-acl | age -r "$BACKUP_RECIPIENT" -o "$temporary_file"
mv -- "$temporary_file" "$backup_file"
echo "Encrypted backup created. Copy it and a consistent encrypted storage snapshot off-site."
