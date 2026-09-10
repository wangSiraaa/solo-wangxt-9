#!/usr/bin/env bash
# 一键启动（开发模式）：用户态 PostgreSQL + NestJS + Vite
# 用法：scripts/dev-up.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> [1/3] 数据库"
bash "$ROOT/scripts/start-db.sh"

echo "==> [2/3] 后端 (NestJS :3000)"
( cd "$ROOT/backend" && [ -d node_modules ] || npm install --no-audit --no-fund )
( cd "$ROOT/backend" && nohup npm run start:dev > /tmp/tls-backend.log 2>&1 & echo $! > /tmp/tls-backend.pid )
echo "    日志: /tmp/tls-backend.log (pid $(cat /tmp/tls-backend.pid))"

echo "==> [3/3] 前端 (Vite :5173)"
( cd "$ROOT/frontend" && [ -d node_modules ] || npm install --no-audit --no-fund )
( cd "$ROOT/frontend" && nohup npm run dev > /tmp/tls-frontend.log 2>&1 & echo $! > /tmp/tls-frontend.pid )
echo "    日志: /tmp/tls-frontend.log (pid $(cat /tmp/tls-frontend.pid))"

sleep 6
echo ""
echo "✅ 就绪：浏览器打开 http://127.0.0.1:5173"
echo "   停止：kill \$(cat /tmp/tls-backend.pid /tmp/tls-frontend.pid)"
