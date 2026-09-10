#!/usr/bin/env bash
# 启动用户态 PostgreSQL（无 Docker / 无 root 场景）。
# 若系统已提供 PostgreSQL，可跳过本脚本，改用环境变量 DB_HOST/DB_PORT/DB_NAME 指向现有实例。
set -euo pipefail

PG_BIN="${PG_BIN:-/home/node/pgsql/usr/lib/postgresql/15/bin}"
PGDATA="${PGDATA:-/home/node/pgdata}"
PGSOCK="${PGSOCK:-/home/node/pg}"
PGPORT="${DB_PORT:-5499}"
DB_NAME="${DB_NAME:-tls_workbench}"
export LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}:/home/node/pgsql/usr/lib/aarch64-linux-gnu"
export PATH="$PG_BIN:$PATH"

if [ ! -d "$PGDATA" ]; then
  echo "[db] 初始化数据目录 $PGDATA"
  initdb -D "$PGDATA" -U postgres --auth=trust --no-locale -E UTF8
  mkdir -p "$PGSOCK"
  {
    echo "unix_socket_directories = '$PGSOCK'"
    echo "listen_addresses = '127.0.0.1'"
    echo "port = $PGPORT"
  } >> "$PGDATA/postgresql.conf"
fi

if ! pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then
  mkdir -p "$PGSOCK"
  echo "[db] 启动 PostgreSQL on 127.0.0.1:$PGPORT"
  pg_ctl -D "$PGDATA" -l "$PGSOCK/server.log" -w start
fi

psql -h 127.0.0.1 -p "$PGPORT" -U postgres -tc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 \
  || createdb -h 127.0.0.1 -p "$PGPORT" -U postgres "$DB_NAME"
echo "[db] ready: postgres@127.0.0.1:$PGPORT/$DB_NAME"
