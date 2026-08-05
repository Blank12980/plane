# ---------------------------------------------------------------------------
# Shared proxy headers for every location that forwards to the Gizmo stack.
#
# Included from the per-site configs; installed by setup-nginx.sh as
# /etc/nginx/conf.d/plane-proxy-params.inc. The .inc extension keeps nginx from
# auto-loading it as a standalone server config (conf.d/*.conf).
#
# Contains headers only — no timeouts, no buffering. Those live in the server
# block so a location can override them; repeating them here would land two
# copies of the same directive in one context, which nginx rejects outright
# ("directive is duplicate").
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

# WebSocket handshakes get "Upgrade: websocket" + "Connection: upgrade"; plain
# requests get both variables empty, and nginx drops empty headers — which
# leaves the upstream connection reusable (see `keepalive` on the upstream).
# Carrying this in every location means no location has to redeclare the header
# set just to add the upgrade pair.
proxy_set_header Upgrade           $http_upgrade;
proxy_set_header Connection        $plane_connection_upgrade;

# Do not let nginx rewrite Location/Refresh headers coming back from the stack.
proxy_redirect off;
