# ---------------------------------------------------------------------------
# Shared proxy headers for every location that forwards to the Gizmo stack.
#
# Included from the per-site configs; installed by setup-nginx.sh as
# /etc/nginx/conf.d/plane-proxy-params.inc. The .inc extension keeps nginx from
# auto-loading it as a standalone server config (conf.d/*.conf).
#
# X-Forwarded-Proto is the critical one: Django reads it via
# SECURE_PROXY_SSL_HEADER (apps/api/plane/settings/production.py) to decide
# whether request.is_secure() is true. Without it the API hands out http://
# presigned MinIO URLs on an https:// page and every upload is blocked as mixed
# content. Caddy re-emits these headers unchanged because TRUSTED_PROXIES
# covers the nginx host.
# ---------------------------------------------------------------------------

proxy_http_version 1.1;

proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Port  $server_port;

# Keep the upstream connection alive for plain HTTP requests. Locations that
# need WebSocket upgrades override Connection/Upgrade themselves.
proxy_set_header Connection        "";

proxy_connect_timeout 60s;
proxy_send_timeout    300s;
proxy_read_timeout    300s;

# Do not let nginx rewrite Location/Refresh headers coming back from the stack.
proxy_redirect off;
