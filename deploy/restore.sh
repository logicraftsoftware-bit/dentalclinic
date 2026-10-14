#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE:?Set an empty, isolated restore database name}"
: "${PGHOST:?Set isolated PostgreSQL restore host}"
: "${PGUSER:?Set PostgreSQL restore user}"
: "${PGPASSWORD:?Supply restore password through the secret environment}"
: "${AGE_IDENTITY_FILE:?Set the path of the restore identity key}"
: "${1:?Supply an encrypted backup file}"
existing_tables="$(psql --dbname="$RESTORE_DATABASE" --tuples-only --no-align --command="SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
if [[ "$existing_tables" != "0" ]]; then
  echo "Restore refused: the target database is not empty." >&2
  exit 1
fi
age -d -i "$AGE_IDENTITY_FILE" "$1" | pg_restore --no-owner --no-acl --exit-on-error --dbname="$RESTORE_DATABASE"
echo "Restore finished. Validate row counts and financial totals before any cutover."
