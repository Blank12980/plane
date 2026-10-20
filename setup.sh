#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE_PATH="${REPO_ROOT}/docker-compose.yml"
ROOT_ENV_PATH="${REPO_ROOT}/.env"
ROOT_ENV_EXAMPLE_PATH="${REPO_ROOT}/.env.example"
PLANE_ENV_PATH="${REPO_ROOT}/plane.env"
API_ENV_PATH="${REPO_ROOT}/apps/api/.env"
API_ENV_EXAMPLE_PATH="${REPO_ROOT}/apps/api/.env.example"
MAIL_STACK_DIR="${REPO_ROOT}/mail-stack"
MAIL_COMPOSE_FILE_PATH="${MAIL_STACK_DIR}/docker-compose.yml"
MAIL_ENV_PATH="${MAIL_STACK_DIR}/.env"
MAIL_ENV_EXAMPLE_PATH="${MAIL_STACK_DIR}/.env.example"
FORGEJO_STACK_DIR="${REPO_ROOT}/forgejo-stack"
FORGEJO_COMPOSE_FILE_PATH="${FORGEJO_STACK_DIR}/docker-compose.yml"
FORGEJO_ENV_PATH="${FORGEJO_STACK_DIR}/.env"
FORGEJO_ENV_EXAMPLE_PATH="${FORGEJO_STACK_DIR}/.env.example"
BACKUP_ROOT="${REPO_ROOT}/backup"

COMPOSE_CMD=""
LAST_COMPOSE_EXIT_CODE=0

function detect_compose() {
    if command -v docker-compose &>/dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        COMPOSE_CMD="docker compose"
    fi
}

function print_header() {
    clear 2>/dev/null || true
    cat <<'EOF'
--------------------------------------------
 ____  _                          ///////// 
|  _ \| | __ _ _ __   ___         ///////// 
| |_) | |/ _` | '_ \ / _ \   /////    ///// 
|  __/| | (_| | | | |  __/   /////    ///// 
|_|   |_|\__,_|_| |_|\___|        ////      
                                  ////      
--------------------------------------------
Local Gizmo build from this repository
--------------------------------------------
EOF
}

function run_compose() {
    pushd "$REPO_ROOT" >/dev/null
    if [[ "$COMPOSE_CMD" == "docker compose" ]]; then
        docker compose "$@"
    else
        docker-compose "$@"
    fi
    LAST_COMPOSE_EXIT_CODE=$?
    popd >/dev/null
}

function run_compose_in_dir() {
    local workdir="$1"
    shift

    pushd "$workdir" >/dev/null
    if [[ "$COMPOSE_CMD" == "docker compose" ]]; then
        docker compose "$@"
    else
        docker-compose "$@"
    fi
    LAST_COMPOSE_EXIT_CODE=$?
    popd >/dev/null
}

function get_env_value() {
    local key="$1"
    local file="$2"

    if [[ ! -f "$file" ]]; then
        echo ""
        return
    fi

    local line
    line=$(grep -m1 "^${key}=" "$file" 2>/dev/null || true)
    if [[ -z "$line" ]]; then
        echo ""
        return
    fi

    local value="${line#*=}"
    # Remove surrounding quotes if present
    value="${value#\"}"
    value="${value%\"}"
    value="${value#\'}"
    value="${value%\'}"
    echo "$value"
}

function update_env_file() {
    local key="$1"
    local value="$2"
    local file="$3"

    if [[ ! -f "$file" ]]; then
        echo "File not found: $file"
        return 1
    fi

    if grep -q "^${key}=" "$file" 2>/dev/null; then
        # Escape special sed characters in value
        local escaped_value
        escaped_value=$(printf '%s\n' "$value" | sed -e 's/[&/\]/\\&/g')
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s|^${key}=.*|${key}=${escaped_value}|g" "$file"
        else
            sed -i "s|^${key}=.*|${key}=${escaped_value}|g" "$file"
        fi
    else
        echo "${key}=${value}" >> "$file"
    fi
}

function new_secret_key() {
    if command -v openssl >/dev/null 2>&1; then
        openssl rand -hex 32
        return
    fi

    local secret=""
    while [[ ${#secret} -lt 50 ]]; do
        secret+=$(LC_ALL=C tr -dc 'a-z0-9' </dev/urandom | head -c $((50 - ${#secret})) || true)
    done

    printf '%s' "$secret"
}

function initialize_local_env_files() {
    if [[ ! -f "$COMPOSE_FILE_PATH" ]]; then
        echo "ERROR: docker-compose.yml not found at ${COMPOSE_FILE_PATH}"
        exit 1
    fi

    if [[ ! -f "$ROOT_ENV_PATH" ]]; then
        if [[ -f "$PLANE_ENV_PATH" ]]; then
            cp "$PLANE_ENV_PATH" "$ROOT_ENV_PATH"
            echo "Created .env from plane.env"
        elif [[ -f "$ROOT_ENV_EXAMPLE_PATH" ]]; then
            cp "$ROOT_ENV_EXAMPLE_PATH" "$ROOT_ENV_PATH"
            echo "Created .env from .env.example"
        else
            echo "ERROR: Neither .env, plane.env, nor .env.example exists in ${REPO_ROOT}"
            exit 1
        fi
    fi

    if [[ ! -f "$API_ENV_PATH" ]]; then
        if [[ -f "$API_ENV_EXAMPLE_PATH" ]]; then
            cp "$API_ENV_EXAMPLE_PATH" "$API_ENV_PATH"
            echo "Created apps/api/.env from apps/api/.env.example"
        else
            echo "ERROR: apps/api/.env does not exist and apps/api/.env.example was not found"
            exit 1
        fi
    fi

    local secret_key
    secret_key=$(get_env_value "SECRET_KEY" "$API_ENV_PATH")
    if [[ -z "$secret_key" ]]; then
        echo "SECRET_KEY=$(new_secret_key)" >> "$API_ENV_PATH"
        echo "Added SECRET_KEY to apps/api/.env"
    fi

    local live_secret_key
    live_secret_key=$(get_env_value "LIVE_SERVER_SECRET_KEY" "$API_ENV_PATH")
    if [[ -z "$live_secret_key" ]]; then
        echo "LIVE_SERVER_SECRET_KEY=$(new_secret_key)" >> "$API_ENV_PATH"
        echo "Added LIVE_SERVER_SECRET_KEY to apps/api/.env"
    fi

    apply_mail_env_defaults
}

# Resolve the effective mail domain / local-mode flags. When MAIL_DOMAIN is
# unset in the root .env we run in local mode: domain "mail.local", self-signed
# TLS. IMPORTANT: we deliberately do NOT write MAIL_DOMAIN into the root .env
# in local mode — deployments/nginx/setup-nginx.sh reads it from there and
# would ask certbot for a doomed Let's Encrypt cert for mail.mail.local.
# Echoes "<domain>|<true|false>" for callers.
function resolve_mail_domain() {
    local mail_domain
    mail_domain=$(get_env_value "MAIL_DOMAIN" "$ROOT_ENV_PATH")
    if [[ -z "$mail_domain" ]]; then
        echo "mail.local|true"
    else
        echo "${mail_domain}|false"
    fi
}

# Expose the resolved mail settings to the API container (read live via
# os.environ by god-mode). Written before the API container is (re)created.
function apply_mail_env_defaults() {
    local resolved mail_domain mail_local
    resolved=$(resolve_mail_domain)
    mail_domain="${resolved%%|*}"
    mail_local="${resolved##*|}"

    update_env_file "MAIL_DOMAIN" "$mail_domain" "$API_ENV_PATH"
    update_env_file "MAIL_LOCAL" "$mail_local" "$API_ENV_PATH"
}

function compose_base_args() {
    echo "-f ${COMPOSE_FILE_PATH} --env-file ${ROOT_ENV_PATH}"
}

function mail_compose_args() {
    echo "-f ${MAIL_COMPOSE_FILE_PATH} --env-file ${ROOT_ENV_PATH} --env-file ${MAIL_ENV_PATH}"
}

function forgejo_compose_args() {
    echo "-f ${FORGEJO_COMPOSE_FILE_PATH} --env-file ${ROOT_ENV_PATH} --env-file ${FORGEJO_ENV_PATH}"
}

function ensure_shared_docker_resources() {
    if ! docker network inspect plane_default >/dev/null 2>&1; then
        echo "Creating shared Docker network: plane_default"
        docker network create plane_default >/dev/null
    fi

    if ! docker volume inspect plane_caddy-data >/dev/null 2>&1; then
        echo "Creating shared Docker volume: plane_caddy-data"
        docker volume create plane_caddy-data >/dev/null
    fi
}

function initialize_mail_env_files() {
    initialize_local_env_files

    if [[ ! -f "$MAIL_COMPOSE_FILE_PATH" ]]; then
        echo "ERROR: mail-stack/docker-compose.yml not found at ${MAIL_COMPOSE_FILE_PATH}"
        exit 1
    fi

    if [[ ! -f "$MAIL_ENV_PATH" ]]; then
        if [[ -f "$MAIL_ENV_EXAMPLE_PATH" ]]; then
            cp "$MAIL_ENV_EXAMPLE_PATH" "$MAIL_ENV_PATH"
            echo "Created mail-stack/.env from mail-stack/.env.example"
        else
            echo "ERROR: mail-stack/.env does not exist and mail-stack/.env.example was not found"
            exit 1
        fi
    fi

    # Resolve the effective mail domain (defaulting to mail.local for local mode)
    # and write it into the mail-stack .env so the mail compose project uses it.
    # The root .env is intentionally left untouched so certbot is not asked for
    # a Let's Encrypt cert for a non-public local domain.
    local resolved mail_domain mail_local
    resolved=$(resolve_mail_domain)
    mail_domain="${resolved%%|*}"
    mail_local="${resolved##*|}"

    update_env_file "MAIL_DOMAIN" "$mail_domain" "$MAIL_ENV_PATH"
    update_env_file "MAIL_LOCAL" "$mail_local" "$MAIL_ENV_PATH"
}

function initialize_forgejo_env_files() {
    initialize_local_env_files

    if [[ ! -f "$FORGEJO_COMPOSE_FILE_PATH" ]]; then
        echo "ERROR: forgejo-stack/docker-compose.yml not found at ${FORGEJO_COMPOSE_FILE_PATH}"
        exit 1
    fi

    if [[ ! -f "$FORGEJO_ENV_PATH" ]]; then
        if [[ -f "$FORGEJO_ENV_EXAMPLE_PATH" ]]; then
            cp "$FORGEJO_ENV_EXAMPLE_PATH" "$FORGEJO_ENV_PATH"
            echo "Created forgejo-stack/.env from forgejo-stack/.env.example"
        else
            echo "ERROR: forgejo-stack/.env does not exist and forgejo-stack/.env.example was not found"
            exit 1
        fi
    fi

    local postgres_password
    postgres_password=$(get_env_value "POSTGRES_PASSWORD" "$FORGEJO_ENV_PATH")
    if [[ -z "$postgres_password" || "$postgres_password" == replace_with_* ]]; then
        postgres_password=$(new_secret_key)
        update_env_file "POSTGRES_PASSWORD" "$postgres_password" "$FORGEJO_ENV_PATH"
        echo "Generated POSTGRES_PASSWORD in forgejo-stack/.env"
    fi

    local forgejo_db_password
    forgejo_db_password=$(get_env_value "FORGEJO_DB_PASSWORD" "$FORGEJO_ENV_PATH")
    if [[ -z "$forgejo_db_password" || "$forgejo_db_password" == replace_with_* ]]; then
        update_env_file "FORGEJO_DB_PASSWORD" "$postgres_password" "$FORGEJO_ENV_PATH"
        echo "Set FORGEJO_DB_PASSWORD to match POSTGRES_PASSWORD in forgejo-stack/.env"
    elif [[ "$forgejo_db_password" != "$postgres_password" ]]; then
        echo "WARNING: FORGEJO_DB_PASSWORD differs from POSTGRES_PASSWORD. Forgejo may not be able to connect to its database."
    fi

    local smtp_password
    smtp_password=$(get_env_value "SMTP_PASSWORD" "$FORGEJO_ENV_PATH")
    if [[ -z "$smtp_password" || "$smtp_password" == replace_with_* ]]; then
        echo "WARNING: SMTP_PASSWORD is not configured in forgejo-stack/.env. Forgejo can start, but mail notifications will fail until git@MAIL_DOMAIN exists in the mail stack."
    fi

    local git_domain
    git_domain=$(get_env_value "GIT_DOMAIN" "$ROOT_ENV_PATH")
    if [[ -z "$git_domain" ]]; then
        echo "ERROR: GIT_DOMAIN is not set in .env."
        exit 1
    fi

    mkdir -p "${FORGEJO_STACK_DIR}/data/forgejo" "${FORGEJO_STACK_DIR}/data/postgres" "${FORGEJO_STACK_DIR}/backups"
}

function build_local_images() {
    export DOCKER_BUILDKIT=1

    local builds=(
        "proxy|plane-proxy|${REPO_ROOT}/apps/proxy|${REPO_ROOT}/apps/proxy/Dockerfile.ce"
        "backend|plane-api plane-worker plane-beat-worker plane-migrator|${REPO_ROOT}/apps/api|${REPO_ROOT}/apps/api/Dockerfile.api"
        "web|plane-web|${REPO_ROOT}|${REPO_ROOT}/apps/web/Dockerfile.web"
        "admin|plane-admin|${REPO_ROOT}|${REPO_ROOT}/apps/admin/Dockerfile.admin"
        "space|plane-space|${REPO_ROOT}|${REPO_ROOT}/apps/space/Dockerfile.space"
        "live|plane-live|${REPO_ROOT}|${REPO_ROOT}/apps/live/Dockerfile.live"
        "mcp|plane-mcp|${REPO_ROOT}|${REPO_ROOT}/apps/mcp/Dockerfile.mcp"
    )

    local no_cache=""
    if [[ "${1:-}" == "true" ]]; then
        no_cache="--no-cache"
    fi

    for entry in "${builds[@]}"; do
        IFS='|' read -r name tags context dockerfile <<< "$entry"

        echo ""
        echo "***** BUILDING ${name} *****"

        local tag_args=()
        for tag in $tags; do
            tag_args+=("-t" "$tag")
        done

        docker build --progress=plain --build-arg DOCKER_BUILDKIT=1 $no_cache "${tag_args[@]}" -f "$dockerfile" "$context"

        if [[ $? -ne 0 ]]; then
            echo "Local Docker image build failed for '${name}'."
            exit 1
        fi
    done
}

function install_plane() {
    echo "Building Gizmo Docker images from the current repository..."
    echo "Repository: ${REPO_ROOT}"
    echo ""

    initialize_local_env_files
    build_local_images false

    echo ""
    echo "Local Gizmo images were built successfully."
    echo "Start the project with: ./setup.sh start"
    echo ""
}

# ---------------------------------------------------------------------------
# Zero-downtime rollout
# ---------------------------------------------------------------------------
# `./setup.sh start|restart` never takes the tracker down while it builds:
#
#   1. every image is built first - the running version keeps serving traffic;
#   2. database migrations run with the NEW image against the live database
#      (keep migrations backward compatible: the old code still runs for the
#      duration of the rollout);
#   3. each stateless service is replaced one by one: the new container is
#      started NEXT TO the old one, we wait for its healthcheck and only then
#      stop the old one. Both containers carry the same compose service name,
#      so Docker DNS (and therefore the proxy) spreads requests across them
#      during the overlap; a container that does not listen yet refuses the
#      connection and the dialer falls through to the healthy one;
#   4. database / redis / rabbitmq / minio are never recreated, the proxy is
#      recreated only when its own image or config changed (~1 second).
#
# If a new container never becomes healthy it is removed again, the old one
# keeps serving and the script exits with an error - a broken build cannot take
# the site down. Use `./setup.sh hard-restart` for a full stop/start (downtime).
ROLLING_SERVICES=(api worker live mcp web admin space)
SINGLETON_SERVICES=(beat-worker)
INFRA_SERVICES=(plane-db plane-redis plane-mq plane-minio)
SERVICE_READY_TIMEOUT="${SERVICE_READY_TIMEOUT:-300}"
OLD_CONTAINER_STOP_TIMEOUT="${OLD_CONTAINER_STOP_TIMEOUT:-30}"

# Like run_compose, but returns the exit status instead of aborting the script.
function compose_try() {
    (
        cd "$REPO_ROOT" || exit 1
        if [[ "$COMPOSE_CMD" == "docker compose" ]]; then
            docker compose $(compose_base_args) "$@"
        else
            docker-compose $(compose_base_args) "$@"
        fi
    )
}

# IDs of every container (running or not) that belongs to a compose service.
function service_container_ids() {
    compose_try ps -aq "$1" 2>/dev/null | sort -u
}

function container_state() {
    docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo "gone"
}

function container_restart_count() {
    docker inspect -f '{{.RestartCount}}' "$1" 2>/dev/null || echo "0"
}

function clear_progress_line() {
    printf "\r%*s\r" 70 ""
}

# Returns 0 once the container is healthy (or, for services without a
# healthcheck, has been up for 10 seconds without restarting).
function wait_container_ready() {
    local id="$1" label="$2"
    local start now state running_since="" restarts_at_start="" idx=0
    start=$(date +%s)

    while true; do
        state=$(container_state "$id")
        now=$(date +%s)
        case "$state" in
            healthy)
                clear_progress_line
                return 0
                ;;
            running)
                if [[ -z "$running_since" ]]; then
                    running_since=$now
                    restarts_at_start=$(container_restart_count "$id")
                elif [[ "$(container_restart_count "$id")" != "$restarts_at_start" ]]; then
                    clear_progress_line
                    return 1
                elif (( now - running_since >= 10 )); then
                    clear_progress_line
                    return 0
                fi
                ;;
            exited|dead|gone|unhealthy|restarting)
                clear_progress_line
                return 1
                ;;
        esac

        if (( now - start > SERVICE_READY_TIMEOUT )); then
            clear_progress_line
            return 1
        fi

        printf "\r>> Waiting for %s to become ready (%ss)%s" "$label" "$((now - start))" "$(printf '%*s' "$((idx % 4))" | tr ' ' '.')"
        idx=$((idx + 1))
        sleep 2
    done
}

function discard_containers() {
    [[ $# -eq 0 ]] && return 0
    docker rm -f "$@" >/dev/null 2>&1 || true
}

function show_container_logs() {
    echo ""
    echo "   ---- last log lines of the container that failed to start ----"
    docker logs --tail 40 "$1" 2>&1 | sed 's/^/   | /'
    echo "   ----------------------------------------------------------------"
}

function rollout_failed() {
    local svc="$1"
    echo ""
    echo "   Rollout of '${svc}' failed. The previous version is still serving traffic."
    echo "   Check the service with: ./setup.sh logs ${svc}"
    exit 1
}

# Replace one stateless service without a gap: new container up and healthy
# first, old container stopped afterwards.
function roll_service() {
    local svc="$1"
    local old_ids new_ids count id

    old_ids=$(service_container_ids "$svc")

    if [[ -z "$old_ids" ]]; then
        echo "   Starting ${svc}..."
        compose_try up -d --no-deps --no-build "$svc" >/dev/null 2>&1 || return 1
        new_ids=$(service_container_ids "$svc")
        for id in $new_ids; do
            if ! wait_container_ready "$id" "$svc"; then
                show_container_logs "$id"
                discard_containers $new_ids
                return 1
            fi
        done
        return 0
    fi

    count=$(echo "$old_ids" | wc -l | tr -d ' ')
    echo "   Rolling ${svc}: starting the new container next to the current one..."
    compose_try up -d --no-deps --no-build --no-recreate --scale "${svc}=$((count + 1))" "$svc" >/dev/null 2>&1 || return 1

    new_ids=$(comm -13 <(echo "$old_ids" | sort) <(service_container_ids "$svc" | sort))
    if [[ -z "$new_ids" ]]; then
        echo "   No new container was created for ${svc}."
        return 1
    fi

    for id in $new_ids; do
        if ! wait_container_ready "$id" "$svc"; then
            show_container_logs "$id"
            discard_containers $new_ids
            return 1
        fi
    done

    echo "   ${svc}: new version is healthy, retiring the old container"
    docker stop -t "$OLD_CONTAINER_STOP_TIMEOUT" $old_ids >/dev/null 2>&1 || true
    discard_containers $old_ids
    # Normalise the replica count (the surviving container keeps its number).
    compose_try up -d --no-deps --no-build --no-recreate --scale "${svc}=${count}" "$svc" >/dev/null 2>&1 || true
}

# Services that must never run twice (celery beat would schedule every task
# twice): stop the old one, then start the new one. A few seconds of missing
# scheduler ticks are invisible to users.
function replace_singleton() {
    local svc="$1"
    local old_ids new_ids id

    old_ids=$(service_container_ids "$svc")
    if [[ -n "$old_ids" ]]; then
        echo "   Replacing ${svc}..."
        docker stop -t "$OLD_CONTAINER_STOP_TIMEOUT" $old_ids >/dev/null 2>&1 || true
        discard_containers $old_ids
    else
        echo "   Starting ${svc}..."
    fi

    compose_try up -d --no-deps --no-build "$svc" >/dev/null 2>&1 || return 1
    new_ids=$(service_container_ids "$svc")
    for id in $new_ids; do
        if ! wait_container_ready "$id" "$svc"; then
            show_container_logs "$id"
            return 1
        fi
    done
}

function run_migrations() {
    echo "   Applying database migrations (the current version keeps serving)..."
    compose_try up -d --no-deps --no-build --force-recreate migrator >/dev/null 2>&1 || {
        echo "   Could not start the migrator service."
        return 1
    }

    local migrator_container_id
    migrator_container_id=$(docker container ls -aq -f "name=plane-migrator" | head -n1)
    [[ -z "$migrator_container_id" ]] && return 0

    local idx=0
    while docker inspect --format='{{.State.Status}}' "$migrator_container_id" 2>/dev/null | grep -q "running"; do
        local dots
        dots=$(printf '%*s' "$idx" | tr ' ' '.')
        printf "\r>> Waiting for Data Migration to finish%s" "$dots"
        idx=$((idx + 1))
        sleep 1
    done
    clear_progress_line

    local migrator_exit_code
    migrator_exit_code=$(docker inspect --format='{{.State.ExitCode}}' "$migrator_container_id")
    if [[ "$migrator_exit_code" != "0" ]]; then
        echo "Gizmo migrations failed - the current version is still running."
        echo ""
        echo "Please check the logs for the migrator service and resolve the issue."
        echo "Logs: ./setup.sh logs migrator"
        return 1
    fi

    echo "   Data Migration completed successfully"
}

# Final end-to-end check through the proxy (the path real users take).
function wait_for_public_endpoint() {
    local proxy_id max_wait=120 start now idx=0
    proxy_id=$(service_container_ids proxy | head -n1)
    [[ -z "$proxy_id" ]] && return 1
    start=$(date +%s)

    while ! docker exec "$proxy_id" curl -fsS -o /dev/null --max-time 5 http://127.0.0.1/api/instances/ >/dev/null 2>&1; do
        now=$(date +%s)
        if (( now - start > max_wait )); then
            clear_progress_line
            return 1
        fi
        printf "\r>> Waiting for the proxy to answer (%ss)%s" "$((now - start))" "$(printf '%*s' "$((idx % 4))" | tr ' ' '.')"
        idx=$((idx + 1))
        sleep 2
    done
    clear_progress_line
}

function acquire_deploy_lock() {
    # Two concurrent rollouts would fight over the replica counts.
    if command -v flock >/dev/null 2>&1; then
        exec 9>"${REPO_ROOT}/.setup.lock"
        if ! flock -n 9; then
            echo "Another ./setup.sh rollout is already running. Wait for it to finish."
            exit 1
        fi
    fi
}

function start_services() {
    initialize_local_env_files
    acquire_deploy_lock

    # Building never touches running containers, so users are not affected.
    build_local_images false

    echo ""
    echo "Rolling out the new version without stopping the running one..."

    # Infrastructure is only created when missing - never recreated here.
    compose_try up -d --no-deps --no-build --no-recreate "${INFRA_SERVICES[@]}" >/dev/null 2>&1 || {
        echo "Could not start the database / redis / rabbitmq / minio services."
        exit 1
    }

    run_migrations || exit 1

    local svc
    for svc in "${ROLLING_SERVICES[@]}"; do
        roll_service "$svc" || rollout_failed "$svc"
    done
    for svc in "${SINGLETON_SERVICES[@]}"; do
        replace_singleton "$svc" || rollout_failed "$svc"
    done

    # Compose recreates the proxy only if its image or configuration changed.
    echo "   Updating proxy (restarted only if its image or config changed)..."
    compose_try up -d --no-deps --no-build proxy >/dev/null 2>&1 || rollout_failed proxy

    if wait_for_public_endpoint; then
        echo "   API Service started successfully"
    else
        echo "   The proxy did not answer the health-check - please verify manually: ./setup.sh status"
    fi

    # Images of previous builds are dangling now; free the disk space.
    docker image prune -f >/dev/null 2>&1 || true

    echo "   Gizmo Server started successfully"
    echo ""

    # The stack itself only listens on 127.0.0.1:${LISTEN_HTTP_PORT}. Reaching
    # it from outside is the host nginx front-end's job, which is set up once,
    # separately, by deployments/nginx/setup-nginx.sh.
    local app_host listen_port
    app_host=$(get_env_value "APP_HOST" "$ROOT_ENV_PATH")
    listen_port=$(get_env_value "LISTEN_HTTP_PORT" "$ROOT_ENV_PATH")

    echo "   Web:   ${app_host:-http://localhost}"
    echo "   API:   ${app_host:-http://localhost}/api"
    echo "   Stack listens on 127.0.0.1:${listen_port:-8081} (plain HTTP, behind nginx)"

    if [[ ! -f /etc/nginx/conf.d/10-plane.conf ]]; then
        echo ""
        echo "   NOTE: the nginx front-end does not look configured on this host."
        echo "         It is a separate, one-time step:"
        echo "           sudo ./deployments/nginx/setup-nginx.sh"
        echo "         Until then the stack is only reachable on 127.0.0.1:${listen_port:-8081}."
    fi
    echo ""
}

function start_mail_services() {
    initialize_mail_env_files
    ensure_shared_docker_resources

    echo "Starting mail stack..."
    run_compose_in_dir "$MAIL_STACK_DIR" $(mail_compose_args) up -d --build
    if [[ $LAST_COMPOSE_EXIT_CODE -ne 0 ]]; then
        exit $LAST_COMPOSE_EXIT_CODE
    fi

    local mail_domain
    mail_domain=$(get_env_value "MAIL_DOMAIN" "$MAIL_ENV_PATH")
    local mail_local
    mail_local=$(get_env_value "MAIL_LOCAL" "$MAIL_ENV_PATH")

    echo "   Mail stack started"
    if [[ "$mail_local" == "true" ]]; then
        echo "   Local mode (no domain): self-signed TLS, mail.${mail_domain}"
        echo "   SMTP:    localhost:587 (STARTTLS)"
        echo "   IMAPS:   localhost:993"
        echo "   Manage mailboxes in god-mode -> Mail (http://localhost/god-mode)"
        echo "   Read/send mail in-app at http://localhost/mail"
    else
        echo "   SMTP:    mail.${mail_domain}:587"
        echo "   IMAPS:   mail.${mail_domain}:993"
    fi
    echo ""
}

function start_git_services() {
    initialize_forgejo_env_files
    ensure_shared_docker_resources

    echo "Starting Forgejo git stack..."
    run_compose_in_dir "$FORGEJO_STACK_DIR" $(forgejo_compose_args) up -d
    if [[ $LAST_COMPOSE_EXIT_CODE -ne 0 ]]; then
        exit $LAST_COMPOSE_EXIT_CODE
    fi

    echo "   Git stack started"
    echo "   Web: https://git.$(get_env_value "GIT_DOMAIN" "$ROOT_ENV_PATH")"
    echo "   SSH: git@git.$(get_env_value "GIT_DOMAIN" "$ROOT_ENV_PATH"):2222"
    echo ""
}

function start_all_services() {
    start_services
    start_mail_services
    start_git_services
}

function stop_services() {
    initialize_local_env_files
    run_compose $(compose_base_args) down
}

function stop_mail_services() {
    initialize_mail_env_files
    run_compose_in_dir "$MAIL_STACK_DIR" $(mail_compose_args) down
}

function stop_git_services() {
    initialize_forgejo_env_files
    run_compose_in_dir "$FORGEJO_STACK_DIR" $(forgejo_compose_args) down
}

function stop_all_services() {
    stop_git_services
    stop_mail_services
    stop_services
}

# A restart is a rolling redeploy (see "Zero-downtime rollout" above): users keep
# working while the new version is built and swapped in.
function restart_services() {
    start_services
}

# Full stop/start including database and proxy. Causes downtime.
function hard_restart_services() {
    stop_services
    start_services
}

function restart_mail_services() {
    stop_mail_services
    start_mail_services
}

function restart_git_services() {
    stop_git_services
    start_git_services
}

function restart_all_services() {
    restart_services
    restart_mail_services
    restart_git_services
}

function rebuild_services() {
    initialize_local_env_files
    echo "Rebuilding local images without cache..."
    build_local_images true
}

function view_specific_logs() {
    local service_name="$1"
    initialize_local_env_files
    run_compose $(compose_base_args) logs -f "$service_name"
}

function view_stack_logs() {
    local stack="$1"
    local service_name="${2:-}"

    case "$stack" in
        plane)
            if [[ -n "$service_name" ]]; then
                view_logs "$service_name"
            else
                run_compose $(compose_base_args) logs -f
            fi
            ;;
        mail)
            initialize_mail_env_files
            if [[ -n "$service_name" ]]; then
                run_compose_in_dir "$MAIL_STACK_DIR" $(mail_compose_args) logs -f "$service_name"
            else
                run_compose_in_dir "$MAIL_STACK_DIR" $(mail_compose_args) logs -f
            fi
            ;;
        git|forgejo)
            initialize_forgejo_env_files
            if [[ -n "$service_name" ]]; then
                run_compose_in_dir "$FORGEJO_STACK_DIR" $(forgejo_compose_args) logs -f "$service_name"
            else
                run_compose_in_dir "$FORGEJO_STACK_DIR" $(forgejo_compose_args) logs -f
            fi
            ;;
        all)
            echo "Streaming Gizmo logs. Open another terminal for mail/git logs if needed."
            run_compose $(compose_base_args) logs -f
            ;;
        *)
            echo "INVALID STACK NAME SUPPLIED"
            ;;
    esac
}

function view_logs() {
    local service_name="${1:-}"

    if [[ -z "$service_name" ]]; then
        echo ""
        echo "Select a Service you want to view the logs for:"
        echo "   1) Web"
        echo "   2) Space"
        echo "   3) API"
        echo "   4) Worker"
        echo "   5) Beat-Worker"
        echo "   6) Migrator"
        echo "   7) Proxy"
        echo "   8) Redis"
        echo "   9) Postgres"
        echo "   10) Minio"
        echo "   11) RabbitMQ"
        echo "   0) Back to Main Menu"
        echo ""

        read -p "Service: " selection

        while [[ -z "$selection" || ! "$selection" =~ ^[0-9]+$ || "$selection" -lt 0 || "$selection" -gt 11 ]]; do
            echo "Invalid selection. Please enter a number between 0 and 11."
            read -p "Service: " selection
        done

        case "$selection" in
            1) view_specific_logs "web" ;;
            2) view_specific_logs "space" ;;
            3) view_specific_logs "api" ;;
            4) view_specific_logs "worker" ;;
            5) view_specific_logs "beat-worker" ;;
            6) view_specific_logs "migrator" ;;
            7) view_specific_logs "proxy" ;;
            8) view_specific_logs "plane-redis" ;;
            9) view_specific_logs "plane-db" ;;
            10) view_specific_logs "plane-minio" ;;
            11) view_specific_logs "plane-mq" ;;
            0) ask_for_action ;;
            *) echo "INVALID SERVICE NAME SUPPLIED" ;;
        esac
    else
        service_name=$(echo "$service_name" | tr '[:upper:]' '[:lower:]')
        case "$service_name" in
            web) view_specific_logs "web" ;;
            space) view_specific_logs "space" ;;
            api) view_specific_logs "api" ;;
            worker) view_specific_logs "worker" ;;
            beat-worker) view_specific_logs "beat-worker" ;;
            migrator) view_specific_logs "migrator" ;;
            proxy) view_specific_logs "proxy" ;;
            redis) view_specific_logs "plane-redis" ;;
            postgres) view_specific_logs "plane-db" ;;
            minio) view_specific_logs "plane-minio" ;;
            rabbitmq) view_specific_logs "plane-mq" ;;
            *) echo "INVALID SERVICE NAME SUPPLIED" ;;
        esac
    fi
}

function show_status() {
    initialize_local_env_files
    run_compose $(compose_base_args) ps
}

function show_mail_status() {
    initialize_mail_env_files
    run_compose_in_dir "$MAIL_STACK_DIR" $(mail_compose_args) ps
}

function show_git_status() {
    initialize_forgejo_env_files
    run_compose_in_dir "$FORGEJO_STACK_DIR" $(forgejo_compose_args) ps
}

function show_all_status() {
    echo ""
    echo "Gizmo:"
    show_status
    echo ""
    echo "Mail:"
    show_mail_status
    echo ""
    echo "Git:"
    show_git_status
}

function backup_container_dir() {
    local backup_folder="$1"
    local container_name="$2"
    local container_data_dir="$3"
    local service_folder="$4"

    echo "Backing up ${container_name} data..."
    local container_id
    container_id=$(run_compose $(compose_base_args) ps -q "$container_name" | head -n1)

    if [[ -z "$container_id" ]]; then
        echo "Error: ${container_name} container not found. Make sure the services are running."
        return 1
    fi

    local service_backup_path="${backup_folder}/${service_folder}"
    mkdir -p "$service_backup_path"

    echo "Copying ${container_name} data directory..."
    if ! docker cp "${container_id}:${container_data_dir}/." "$service_backup_path/"; then
        echo "Error: Failed to copy ${service_folder} data"
        rm -rf "$service_backup_path"
        return 1
    fi

    pushd "$backup_folder" >/dev/null
    if tar -czf "${service_folder}.tar.gz" "$service_folder/"; then
        rm -rf "$service_backup_path"
    fi
    popd >/dev/null

    echo "Successfully backed up ${service_folder} data"
}

function backup_data() {
    local datetime
    datetime=$(date +"%Y%m%d-%H%M")
    local backup_folder="${BACKUP_ROOT}/${datetime}"
    mkdir -p "$backup_folder"

    if ! backup_container_dir "$backup_folder" "plane-db" "/var/lib/postgresql/data" "pgdata"; then exit 1; fi
    if ! backup_container_dir "$backup_folder" "plane-minio" "/export" "uploads"; then exit 1; fi
    if ! backup_container_dir "$backup_folder" "plane-mq" "/var/lib/rabbitmq" "rabbitmq_data"; then exit 1; fi
    if ! backup_container_dir "$backup_folder" "plane-redis" "/data" "redisdata"; then exit 1; fi

    echo ""
    echo "Backup completed successfully. Backup files are stored in ${backup_folder}"
    echo ""
}

function normalize_target() {
    local target="${1:-plane}"
    target=$(echo "$target" | tr '[:upper:]' '[:lower:]')

    case "$target" in
        ""|plane) echo "plane" ;;
        mail|email|smtp) echo "mail" ;;
        git|forgejo|gitea) echo "git" ;;
        all|full) echo "all" ;;
        *) echo "$target" ;;
    esac
}

function start_target() {
    local target
    target=$(normalize_target "${1:-plane}")

    case "$target" in
        plane) start_services ;;
        mail) start_mail_services ;;
        git) start_git_services ;;
        all) start_all_services ;;
        *) echo "INVALID TARGET SUPPLIED. Use: plane, mail, git, all" ;;
    esac
}

function stop_target() {
    local target
    target=$(normalize_target "${1:-plane}")

    case "$target" in
        plane) stop_services ;;
        mail) stop_mail_services ;;
        git) stop_git_services ;;
        all) stop_all_services ;;
        *) echo "INVALID TARGET SUPPLIED. Use: plane, mail, git, all" ;;
    esac
}

function restart_target() {
    local target
    target=$(normalize_target "${1:-plane}")

    case "$target" in
        plane) restart_services ;;
        mail) restart_mail_services ;;
        git) restart_git_services ;;
        all) restart_all_services ;;
        *) echo "INVALID TARGET SUPPLIED. Use: plane, mail, git, all" ;;
    esac
}

function status_target() {
    local target
    target=$(normalize_target "${1:-plane}")

    case "$target" in
        plane) show_status ;;
        mail) show_mail_status ;;
        git) show_git_status ;;
        all) show_all_status ;;
        *) echo "INVALID TARGET SUPPLIED. Use: plane, mail, git, all" ;;
    esac
}

function ask_for_action() {
    local default_action="${1:-}"
    local action=""

    if [[ -z "$default_action" ]]; then
        echo ""
        echo "Select a Action you want to perform:"
        echo "   1) Install / Build local images"
        echo "   2) Start all (Gizmo + mail + git)"
        echo "   3) Start Gizmo only (rolling update, no downtime when already running)"
        echo "   4) Start mail server only"
        echo "   5) Start git server only"
        echo "   6) Stop all"
        echo "   7) Stop Gizmo only"
        echo "   8) Stop mail server only"
        echo "   9) Stop git server only"
        echo "   10) Restart all"
        echo "   11) Restart Gizmo only (rolling, no downtime; ./setup.sh hard-restart = full stop/start)"
        echo "   12) Restart mail server only"
        echo "   13) Restart git server only"
        echo "   14) Rebuild Gizmo images without cache"
        echo "   15) View Logs"
        echo "   16) Backup Gizmo Data"
        echo "   17) Status"
        echo "   18) Exit"
        echo ""

        read -p "Action [3]: " action

        while [[ -n "$action" && ( ! "$action" =~ ^[0-9]+$ || "$action" -lt 1 || "$action" -gt 18 ) ]]; do
            echo "${action}: invalid selection."
            read -p "Action [3]: " action
        done

        if [[ -z "$action" ]]; then
            action="3"
        fi

        echo ""
    fi

    local resolved_action="$action"
    if [[ -z "$resolved_action" && -n "$default_action" ]]; then
        resolved_action="$default_action"
    fi

    case "$resolved_action" in
        1|install|build)
            install_plane
            ;;
        2)
            start_target all
            ;;
        3|start|up)
            start_target "${2:-plane}"
            ;;
        4)
            start_target mail
            ;;
        5)
            start_target git
            ;;
        6)
            stop_target all
            ;;
        7|stop|down)
            stop_target "${2:-plane}"
            ;;
        8)
            stop_target mail
            ;;
        9)
            stop_target git
            ;;
        10)
            restart_target all
            ;;
        11|restart)
            restart_target "${2:-plane}"
            ;;
        hard-restart)
            hard_restart_services
            ;;
        12)
            restart_target mail
            ;;
        13)
            restart_target git
            ;;
        14|rebuild)
            rebuild_services
            ;;
        15|logs)
            if [[ -n "${2:-}" ]]; then
                local log_target
                log_target=$(normalize_target "$2")
                if [[ "$log_target" == "plane" || "$log_target" == "mail" || "$log_target" == "git" || "$log_target" == "all" ]]; then
                    view_stack_logs "$log_target" "${3:-}"
                else
                    view_logs "$2"
                fi
            else
                view_logs
            fi
            ;;
        16|backup)
            backup_data
            ;;
        17|status|ps)
            status_target "${2:-plane}"
            ;;
        18)
            exit 0
            ;;
        *)
            echo "INVALID ACTION SUPPLIED"
            ;;
    esac
}

# Initialize
detect_compose
print_header

# Allow passing arguments directly, e.g. ./setup.sh start
if [[ $# -gt 0 ]]; then
    ask_for_action "$@"
else
    ask_for_action
fi
