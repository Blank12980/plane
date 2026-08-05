#!/bin/sh
set -e

mkdir -p /etc/caddy/conf.d

# Clean any previously enabled add-on snippets so this is idempotent across
# restarts. mail.caddy is removed unconditionally: the mail stack no longer
# gets its certificate from Caddy — certbot on the host issues it now — so the
# snippet must not survive an upgrade from an older deployment.
rm -f /etc/caddy/conf.d/mail.caddy /etc/caddy/conf.d/git.caddy

# Enable forgejo git hosting only when GIT_DOMAIN is provided.
if [ -n "${GIT_DOMAIN}" ]; then
    cp /etc/caddy/Caddyfile.git /etc/caddy/conf.d/git.caddy
fi

# Hand off to the upstream caddy entrypoint with the standard args.
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
