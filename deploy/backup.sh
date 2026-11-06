#!/bin/sh
set -eu
umask 077

: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
: "${POSTGRES_DB:?POSTGRES_DB is required}"

timestamp="$(date -u +'%Y%m%d-%H%M')"
dump_file="/backups/wxdaily-$timestamp.dump"
uploads_archive="/backups/wxdaily-$timestamp-uploads.tar.gz"

mkdir -p /backups /data/uploads

export PGPASSWORD="$POSTGRES_PASSWORD"
pg_dump -Fc --host=db --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" --file="$dump_file"
tar -czf "$uploads_archive" -C /data uploads

find /backups -maxdepth 1 -type f -name 'wxdaily-*' -mtime +14 -delete
