# nginx front-end

Runs the Gizmo stack behind a host-level nginx instead of letting Caddy own
ports 80/443.

```
internet ──► nginx (host)                        TLS terminated here
             :80  → ACME challenge + redirect    certs from certbot
             :443 → 127.0.0.1:8081
                     │
                     ▼
             Caddy container (plain HTTP, loopback-only)
                     │  path routing
        ┌────────────┼─────────────┬──────────┬───────────┬──────────┐
        ▼            ▼             ▼          ▼           ▼          ▼
    web:3000    api:8000     space:3000  admin:3000  live:3000  minio:9000
                /api /auth    /spaces    /god-mode     /live     /uploads
                /static
```

Three names are served:

| Name                | What it is                                              |
| ------------------- | ------------------------------------------------------- |
| `$APP_HOST`         | the app itself                                           |
| `git.$GIT_DOMAIN`   | Forgejo (nginx → Caddy → `forgejo:3000`)                  |
| `mail.$MAIL_DOMAIN` | no web service — the block exists so certbot can renew the certificate Postfix/Dovecot use |

## Install

This is a **one-time, separate step**. The stack itself is started and stopped
with `./setup.sh` as usual; that script never touches nginx, and this one never
builds, starts or stops a container. Its only Docker interaction is the renewal
hook it installs, which signals the running Postfix/Dovecot containers after a
certificate is replaced.

Prerequisites: DNS A/AAAA records for all three names point at this host, and
ports 80/443 are open.

```bash
cd /path/to/plane

# 1. Free up 80/443 — an older deployment published them from the container.
./setup.sh stop

# 2. Sanity-check what will be generated (no root needed, changes nothing).
./deployments/nginx/setup-nginx.sh --render-only
cat deployments/nginx/out/10-plane.conf

# 3. Install nginx + certbot, issue certificates, write the configs.
sudo ./deployments/nginx/setup-nginx.sh

# 4. Back to the normal launch path. The stack binds 127.0.0.1:8081 only.
./setup.sh start
```

After this, day-to-day operation is just `./setup.sh start` / `stop` /
`restart`. Re-run `setup-nginx.sh` only when a domain, `LISTEN_HTTP_PORT`,
`FILE_SIZE_LIMIT` or `AWS_S3_BUCKET_NAME` changes in the root `.env`.

Rehearse against the Let's Encrypt staging CA first with
`sudo ./deployments/nginx/setup-nginx.sh --staging`. Staging certificates are
untrusted by browsers; delete `/etc/letsencrypt/live/<domain>` and re-run
without the flag to get real ones.

If certificates already exist on the host (copied from elsewhere, issued by
another tool), use `--skip-certbot` — the script then only writes the nginx
configs and expects `/etc/letsencrypt/live/<domain>/{fullchain,privkey}.pem`.

## What it writes

| Path                                                       | Purpose                              |
| ---------------------------------------------------------- | ------------------------------------ |
| `/etc/nginx/conf.d/00-plane-common.conf`                    | upstream + WebSocket upgrade map     |
| `/etc/nginx/conf.d/10-plane.conf`                           | the app                              |
| `/etc/nginx/conf.d/20-git.conf`                             | Forgejo (only if `GIT_DOMAIN` is set) |
| `/etc/nginx/conf.d/30-mail.conf`                            | mail cert holder (only if `MAIL_DOMAIN` is set) |
| `/etc/nginx/conf.d/plane-proxy-params.inc`                  | shared `proxy_set_header` block      |
| `/var/www/certbot`                                          | HTTP-01 challenge webroot            |
| `/etc/letsencrypt/renewal-hooks/deploy/reload-plane.sh`     | reloads nginx + Postfix + Dovecot after renewal |

Everything is regenerated from `templates/` on each run, so re-running the
script is the way to pick up changes to `APP_HOST`, `GIT_DOMAIN`,
`MAIL_DOMAIN`, `LISTEN_HTTP_PORT`, `FILE_SIZE_LIMIT` or `AWS_S3_BUCKET_NAME` in
the root `.env`. Nothing here is created or modified by `./setup.sh`.

## Things that will bite you

**`X-Forwarded-Proto` must survive to Django.** `plane-proxy-params.inc` sets
it, and `TRUSTED_PROXIES` in `.env` is what makes Caddy forward it unchanged
instead of overwriting it with `http`. Django reads it via
`SECURE_PROXY_SSL_HEADER`; if it gets lost, `request.is_secure()` is false, the
API hands out `http://` presigned MinIO URLs on an `https://` page, and every
file upload silently fails as mixed content.

**`SITE_ADDRESS` must stay `:80`.** Put a hostname there and Caddy switches on
automatic HTTPS, tries to bind `:443` inside the container and runs its own ACME
challenges against a port nginx already owns.

**Upload size is capped in three places.** `client_max_body_size` in
`10-plane.conf`, `request_body max_size` in the Caddyfile, and the limit the API
advertises — all fed from `FILE_SIZE_LIMIT`. The smallest one wins.

**`APP_HOST` behaves differently depending on how you build.** `./setup.sh`
builds the frontend images with `docker build` and passes no `VITE_*` args, so
`API_BASE_URL` and friends fall back to `""` (see
`packages/constants/src/endpoints.ts`) and the bundles address the API
relatively — they work on whatever origin serves them. Building through
`docker compose build` instead *does* pass `APP_HOST`-derived `VITE_*_BASE_URL`
args and hard-codes the domain into the bundles.

Either way `APP_HOST` still matters at runtime: the API derives `WEB_URL`,
`CORS_ALLOWED_ORIGINS`, `CSRF_TRUSTED_ORIGINS`, the MinIO custom domain and all
outgoing email links from it. Those are plain container env vars, so a
`./setup.sh restart` is enough after changing it — no rebuild.

## Certificate renewal

`certbot.timer` handles renewal. After each successful renewal the deploy hook
reloads nginx and signals the mail containers:

```sh
nginx -t && systemctl reload nginx
docker kill --signal=SIGHUP postfix
docker exec dovecot doveadm reload
```

Postfix and Dovecot read the certificate directly from `/etc/letsencrypt`,
mounted read-only into both containers (`mail-stack/docker-compose.yml`). This
replaces the old `cert-reloader` container, which watched Caddy's data volume
with inotify — that volume no longer receives the mail certificate, and
inotify does not see certbot renewals anyway because they swap symlinks rather
than rewrite files.

Check status with:

```bash
sudo certbot certificates
sudo systemctl list-timers certbot.timer
sudo certbot renew --dry-run
```

## Troubleshooting

```bash
# nginx sees the stack?
curl -sI http://127.0.0.1:8081/ -H 'Host: plane.example.com'

# end to end
curl -sI https://plane.example.com/

# the API believes it is on https?  X-Forwarded-Proto arrived if this is https://
curl -s https://plane.example.com/api/instances/ | head -c 400

# WebSocket upgrade for the collaborative editor
curl -sI https://plane.example.com/live/ \
     -H 'Connection: Upgrade' -H 'Upgrade: websocket'

tail -f /var/log/nginx/plane.error.log
./setup.sh logs proxy
```

`502 Bad Gateway` on every path almost always means the stack is down or bound
to the wrong port — check `./setup.sh status` and that `LISTEN_HTTP_PORT`
matches the `upstream` block in `00-plane-common.conf`.

## Not covered by this script

`deployments/cli/` and `deployments/aio/` are separate all-in-one installers
with their own Caddy-based proxies. They are untouched; this front-end targets
the root `docker-compose.yml` deployment.
