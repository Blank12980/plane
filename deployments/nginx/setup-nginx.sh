#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Install and configure the host nginx front-end for the Gizmo stack.
#
# Layout this produces:
#
#   internet :443/:80  ->  nginx (host, TLS terminated here, certs from certbot)
#                      ->  127.0.0.1:${LISTEN_HTTP_PORT}  (Caddy container, HTTP)
#                      ->  web / api / space / admin / live / minio containers
#
# Run on the server, as root, from anywhere:
#
#   sudo ./deployments/nginx/setup-nginx.sh
#
# Options:
#   --staging        use the Let's Encrypt staging CA (no rate limits, untrusted
#                    certs) — good for a first rehearsal
#   --skip-certbot   do not touch certificates; assume /etc/letsencrypt already
#                    holds them (e.g. copied from another host)
#   --render-only    render the configs into ./out and exit, changing nothing
#                    on the system. Works on any machine, root not required.
#   --env-file PATH  read settings from PATH instead of <repo>/.env
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="${SCRIPT_DIR}/templates"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

ENV_FILE="${REPO_ROOT}/.env"
NGINX_CONF_DIR="/etc/nginx/conf.d"
WEBROOT="/var/www/certbot"
CERTBOT_STAGING=""
SKIP_CERTBOT=0
RENDER_ONLY=0
RENDER_OUT="${SCRIPT_DIR}/out"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --staging)      CERTBOT_STAGING="--staging"; shift ;;
        --skip-certbot) SKIP_CERTBOT=1; shift ;;
        --render-only)  RENDER_ONLY=1; shift ;;
        --env-file)     ENV_FILE="$2"; shift 2 ;;
        -h|--help)      sed -n '2,25p' "${BASH_SOURCE[0]}"; exit 0 ;;
        *)              echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m warn\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror\033[0m %s\n' "$*" >&2; exit 1; }

# --- Read settings from the root .env --------------------------------------
# Deliberately not `source`-ing it: the file contains shell-hostile values and
# comments, and we only want a handful of keys.
env_value() {
    local key="$1" default="${2-}" value
    value="$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
    value="${value%%#*}"                       # strip trailing comment
    value="$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
    value="${value%\"}"; value="${value#\"}"   # strip surrounding quotes
    value="${value%\'}"; value="${value#\'}"
    printf '%s' "${value:-$default}"
}

[[ -f "$ENV_FILE" ]] || die "env file not found: ${ENV_FILE}"

APP_HOST="$(env_value APP_HOST "https://localhost")"
GIT_DOMAIN="$(env_value GIT_DOMAIN)"
MAIL_DOMAIN="$(env_value MAIL_DOMAIN)"
LISTEN_HTTP_PORT="$(env_value LISTEN_HTTP_PORT 8081)"
FILE_SIZE_LIMIT="$(env_value FILE_SIZE_LIMIT 5242880)"
BUCKET_NAME="$(env_value AWS_S3_BUCKET_NAME uploads)"
CERT_EMAIL="$(env_value CERT_EMAIL)"

# https://plane.example.com/ -> plane.example.com
APP_DOMAIN="${APP_HOST#*://}"
APP_DOMAIN="${APP_DOMAIN%%/*}"
APP_DOMAIN="${APP_DOMAIN%%:*}"

[[ -n "$APP_DOMAIN" ]] || die "could not derive a domain from APP_HOST=${APP_HOST}"
[[ "$APP_DOMAIN" != "localhost" ]] || die \
    "APP_HOST points at localhost; set it to the public https:// URL before running this"

DOMAINS=("$APP_DOMAIN")
if [[ -n "$GIT_DOMAIN"  ]]; then DOMAINS+=("git.${GIT_DOMAIN}");  fi
if [[ -n "$MAIL_DOMAIN" ]]; then DOMAINS+=("mail.${MAIL_DOMAIN}"); fi

log "Settings from ${ENV_FILE}"
echo "    app domain ......... ${APP_DOMAIN}"
if [[ -n "$GIT_DOMAIN"  ]]; then echo "    git domain ......... git.${GIT_DOMAIN}";
                            else echo "    git domain ......... (disabled)"; fi
if [[ -n "$MAIL_DOMAIN" ]]; then echo "    mail domain ........ mail.${MAIL_DOMAIN}";
                            else echo "    mail domain ........ (disabled)"; fi
echo "    stack upstream ..... 127.0.0.1:${LISTEN_HTTP_PORT}"
echo "    max upload ......... ${FILE_SIZE_LIMIT} bytes"
echo "    minio bucket ....... /${BUCKET_NAME}"

if [[ "${APP_HOST%%://*}" != "https" && "$SKIP_CERTBOT" -eq 0 ]]; then
    warn "APP_HOST is not https://. nginx will serve TLS anyway, but the web/admin/space"
    warn "bundles are built from APP_HOST — fix it in .env and rebuild, or logins will break."
fi

# --- Render ----------------------------------------------------------------
# envsubst is given an explicit variable list so nginx's own $host, $scheme,
# $http_upgrade ... survive untouched.
export APP_DOMAIN GIT_DOMAIN MAIL_DOMAIN LISTEN_HTTP_PORT FILE_SIZE_LIMIT BUCKET_NAME

render_all() {
    local dest="$1"
    mkdir -p "$dest"

    envsubst '${LISTEN_HTTP_PORT}' \
        < "${TEMPLATE_DIR}/00-plane-common.conf.template" > "${dest}/00-plane-common.conf"

    envsubst '${APP_DOMAIN} ${FILE_SIZE_LIMIT} ${BUCKET_NAME}' \
        < "${TEMPLATE_DIR}/10-plane.conf.template" > "${dest}/10-plane.conf"

    cp "${TEMPLATE_DIR}/plane-proxy-params.inc" "${dest}/plane-proxy-params.inc"

    if [[ -n "$GIT_DOMAIN" ]]; then
        envsubst '${GIT_DOMAIN}' \
            < "${TEMPLATE_DIR}/20-git.conf.template" > "${dest}/20-git.conf"
    else
        rm -f "${dest}/20-git.conf"
    fi

    if [[ -n "$MAIL_DOMAIN" ]]; then
        envsubst '${MAIL_DOMAIN}' \
            < "${TEMPLATE_DIR}/30-mail.conf.template" > "${dest}/30-mail.conf"
    else
        rm -f "${dest}/30-mail.conf"
    fi
}

if [[ "$RENDER_ONLY" -eq 1 ]]; then
    command -v envsubst >/dev/null || die "envsubst not found (install gettext)"
    render_all "$RENDER_OUT"
    log "Rendered configs into ${RENDER_OUT}"
    ls -1 "$RENDER_OUT"
    exit 0
fi

[[ "$(id -u)" -eq 0 ]] || die "run as root (sudo $0)"

# --- Install nginx + certbot -----------------------------------------------
install_packages() {
    local missing=()
    command -v nginx    >/dev/null || missing+=(nginx)
    command -v certbot  >/dev/null || missing+=(certbot)
    command -v envsubst >/dev/null || missing+=(gettext-base)

    [[ ${#missing[@]} -eq 0 ]] && { log "nginx, certbot and envsubst already present"; return; }

    log "Installing: ${missing[*]}"
    if command -v apt-get >/dev/null; then
        # python3-certbot-nginx also ships the recommended TLS snippets that the
        # site configs include.
        DEBIAN_FRONTEND=noninteractive apt-get update -qq
        DEBIAN_FRONTEND=noninteractive apt-get install -y "${missing[@]}" python3-certbot-nginx
    elif command -v dnf >/dev/null; then
        dnf install -y "${missing[@]/gettext-base/gettext}" python3-certbot-nginx
    elif command -v yum >/dev/null; then
        yum install -y "${missing[@]/gettext-base/gettext}" python3-certbot-nginx
    else
        die "no supported package manager found; install nginx, certbot and gettext manually"
    fi
}
install_packages

mkdir -p "$WEBROOT" "$NGINX_CONF_DIR"

# --- Free port 80/443 from the stack ---------------------------------------
if command -v ss >/dev/null && ss -lntp 2>/dev/null | grep -qE ':(80|443)[[:space:]].*docker-proxy'; then
    warn "A Docker container is still publishing port 80 and/or 443."
    warn "Stop it first, e.g.:  docker compose --env-file .env stop proxy"
    die  "refusing to continue while the ports are taken"
fi

# --- Phase 1: HTTP-only bootstrap so certbot can validate ------------------
if [[ "$SKIP_CERTBOT" -eq 0 ]]; then
    log "Installing bootstrap HTTP config"
    # Move any previous Gizmo configs out of the way — they reference certs.
    for f in 00-plane-common.conf 10-plane.conf 20-git.conf 30-mail.conf; do
        if [[ -f "${NGINX_CONF_DIR}/${f}" ]]; then
            mv "${NGINX_CONF_DIR}/${f}" "${NGINX_CONF_DIR}/${f}.bak"
        fi
    done

    ALL_DOMAINS="${DOMAINS[*]}" envsubst '${ALL_DOMAINS}' \
        < "${TEMPLATE_DIR}/bootstrap.conf.template" > "${NGINX_CONF_DIR}/00-plane-bootstrap.conf"

    nginx -t
    systemctl enable --now nginx >/dev/null 2>&1 || true
    systemctl reload nginx 2>/dev/null || systemctl restart nginx

    # --- Obtain one certificate per domain ---------------------------------
    # Separate certs (not one SAN cert) so /etc/letsencrypt/live/<domain>/ paths
    # stay predictable for nginx and for the Postfix/Dovecot containers.
    certbot_email_args=(--register-unsafely-without-email)
    [[ -n "$CERT_EMAIL" ]] && certbot_email_args=(--email "$CERT_EMAIL")

    for domain in "${DOMAINS[@]}"; do
        if [[ -f "/etc/letsencrypt/live/${domain}/fullchain.pem" ]]; then
            log "Certificate for ${domain} already exists — skipping issuance"
            continue
        fi
        log "Requesting certificate for ${domain}"
        certbot certonly --webroot -w "$WEBROOT" \
            -d "$domain" \
            --cert-name "$domain" \
            --agree-tos --non-interactive --keep-until-expiring \
            ${CERTBOT_STAGING} \
            "${certbot_email_args[@]}"
    done

    rm -f "${NGINX_CONF_DIR}/00-plane-bootstrap.conf"
    rm -f "${NGINX_CONF_DIR}"/00-plane-common.conf.bak \
          "${NGINX_CONF_DIR}"/10-plane.conf.bak \
          "${NGINX_CONF_DIR}"/20-git.conf.bak \
          "${NGINX_CONF_DIR}"/30-mail.conf.bak
fi

# --- TLS snippets the site configs include ---------------------------------
if [[ ! -f /etc/letsencrypt/options-ssl-nginx.conf ]]; then
    warn "certbot's options-ssl-nginx.conf is missing; writing a sane default"
    cat > /etc/letsencrypt/options-ssl-nginx.conf <<'EOF'
ssl_session_cache   shared:le_nginx_SSL:10m;
ssl_session_timeout 1440m;
ssl_session_tickets off;
ssl_protocols       TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
ssl_ciphers "ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384";
EOF
fi

if [[ ! -f /etc/letsencrypt/ssl-dhparams.pem ]]; then
    log "Generating DH parameters (this takes a minute)"
    openssl dhparam -out /etc/letsencrypt/ssl-dhparams.pem 2048
fi

# --- Phase 2: the real configs ---------------------------------------------
log "Installing site configs into ${NGINX_CONF_DIR}"
render_all "$NGINX_CONF_DIR"

for domain in "${DOMAINS[@]}"; do
    [[ -f "/etc/letsencrypt/live/${domain}/fullchain.pem" ]] || \
        die "missing certificate for ${domain} — nginx will not start. Re-run without --skip-certbot."
done

nginx -t
systemctl reload nginx

# --- Renewal hook: reload nginx and the mail daemons ------------------------
log "Installing certbot renewal deploy hook"
mkdir -p /etc/letsencrypt/renewal-hooks/deploy
cat > /etc/letsencrypt/renewal-hooks/deploy/reload-plane.sh <<'EOF'
#!/bin/sh
# Installed by deployments/nginx/setup-nginx.sh.
# Runs after every successful certbot renewal.
set -e

nginx -t && systemctl reload nginx

# Postfix and Dovecot read the certs straight out of /etc/letsencrypt (mounted
# read-only, see mail-stack/docker-compose.yml) and need a nudge to re-read them.
if command -v docker >/dev/null 2>&1; then
    docker kill --signal=SIGHUP postfix >/dev/null 2>&1 || true
    docker exec dovecot doveadm reload  >/dev/null 2>&1 || true
fi
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-plane.sh

# Debian/RHEL certbot packages ship a timer already; make sure it is running.
systemctl enable --now certbot.timer >/dev/null 2>&1 || \
    warn "certbot.timer not found — add a cron entry for 'certbot renew' yourself"

log "Done."
echo
echo "  https://${APP_DOMAIN}"
[[ -n "$GIT_DOMAIN"  ]] && echo "  https://git.${GIT_DOMAIN}"
[[ -n "$MAIL_DOMAIN" ]] && echo "  mail.${MAIL_DOMAIN} (certificate only, no web service)"
echo
echo "Next: start the stack with the Caddy proxy bound to loopback:"
echo "  docker compose --env-file .env up -d"
