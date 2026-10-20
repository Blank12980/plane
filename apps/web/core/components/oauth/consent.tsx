/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import useSWR from "swr";
// gizmo imports
import { Button } from "@plane/propel/button";
import { McpService } from "@plane/services";
import type { TOAuthConsent } from "@plane/types";
import { MCP_SCOPES, MCP_SCOPE_PRESETS, cn } from "@plane/utils";

const mcpService = new McpService();

const ALL_WORKSPACES = "*";

const errorText = (error: unknown): string => {
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.error === "string") return record.error;
    const first = Object.values(record).flat()[0];
    if (typeof first === "string") return first;
  }
  return "Попробуйте ещё раз.";
};

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-1 p-4">
      <main className="w-full max-w-lg space-y-5 rounded-lg border border-subtle bg-surface-1 p-6 text-primary shadow-raised-100">
        {children}
      </main>
    </div>
  );
}

function Problem({ title, message }: { title: string; message: string }) {
  return (
    <Card>
      <h1 className="text-18 font-semibold">{title}</h1>
      <p role="alert" className="text-13 text-secondary">
        {message}
      </p>
      <p className="text-13 text-tertiary">Вернитесь в приложение и начните подключение заново.</p>
    </Card>
  );
}

function ConsentForm({
  requestId,
  consent,
  onDone,
}: {
  requestId: string;
  consent: TOAuthConsent;
  onDone: (redirectUrl: string, approved: boolean) => void;
}) {
  // a scope preset the instance allows is the fastest way to a sensible choice
  const allowed = consent.scopes.allowed;
  const presets = MCP_SCOPE_PRESETS.filter((preset) => preset.scopes.every((scope) => allowed.includes(scope)));
  const [scopes, setScopes] = useState<string[]>(consent.scopes.default);
  const [target, setTarget] = useState(
    consent.allow_all_workspaces && consent.workspaces.length > 1
      ? ALL_WORKSPACES
      : (consent.workspaces[0]?.slug ?? (consent.allow_all_workspaces ? ALL_WORKSPACES : ""))
  );
  const [isSubmitting, setIsSubmitting] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (scope: string) =>
    setScopes((current) => (current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope]));

  const decide = async (decision: "approve" | "deny") => {
    setIsSubmitting(decision);
    setError(null);
    try {
      const response = await mcpService.oauthDecide(
        requestId,
        decision === "deny"
          ? { decision, consent_token: consent.consent_token }
          : {
              decision,
              consent_token: consent.consent_token,
              scopes,
              all_workspaces: target === ALL_WORKSPACES,
              ...(target === ALL_WORKSPACES ? {} : { workspace_slug: target }),
            }
      );
      onDone(response.redirect_url, decision === "approve");
    } catch (decideError) {
      setError(errorText(decideError));
      setIsSubmitting(null);
    }
  };

  const canApprove = scopes.includes("read") && Boolean(target) && consent.workspaces.length > 0;

  return (
    <Card>
      <div className="space-y-1">
        <h1 className="text-18 font-semibold">«{consent.client.name}» хочет получить доступ к Gizmo</h1>
        <p className="text-13 text-secondary">
          Вы вошли как <span className="font-medium text-primary">{consent.user.email}</span>. Приложение будет работать
          от вашего имени и никогда не получит больше прав, чем у вас есть. После вашего выбора вы вернётесь в{" "}
          <span className="font-medium text-primary">{consent.client.redirect_host}</span>.
        </p>
        <p className="text-12 text-tertiary">
          Приложение зарегистрировалось само, Gizmo его не проверяло. Разрешайте доступ, только если вы сами начали это
          подключение и узнаёте адрес выше.
        </p>
      </div>

      {consent.workspaces.length === 0 ? (
        <p role="alert" className="rounded-md border border-warning-strong/40 bg-warning-subtle p-3 text-13">
          У вас нет пространств, к которым можно подключить приложение.
        </p>
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="text-13 font-medium text-primary">Где можно работать</legend>
            <select
              aria-label="Пространство"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="w-full rounded border border-subtle bg-surface-1 p-2 text-13"
            >
              {consent.allow_all_workspaces && (
                <option value={ALL_WORKSPACES}>Все мои пространства ({consent.workspaces.length})</option>
              )}
              {consent.workspaces.map((workspace) => (
                <option key={workspace.slug} value={workspace.slug}>
                  {workspace.name}
                </option>
              ))}
            </select>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-13 font-medium text-primary">Что разрешено</legend>
            {presets.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setScopes(preset.scopes)}
                    className={cn("rounded border px-2 py-1 text-12", {
                      "border-accent-strong bg-accent-primary/5":
                        preset.scopes.length === scopes.length && preset.scopes.every((s) => scopes.includes(s)),
                      "border-subtle hover:bg-layer-1": !(
                        preset.scopes.length === scopes.length && preset.scopes.every((s) => scopes.includes(s))
                      ),
                    })}
                  >
                    {preset.title}
                  </button>
                ))}
              </div>
            )}
            <div className="space-y-1">
              {MCP_SCOPES.filter((item) => allowed.includes(item.scope)).map((item) => (
                <label key={item.scope} className="flex items-start gap-2 rounded border border-subtle p-2 text-13">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={scopes.includes(item.scope)}
                    onChange={() => toggle(item.scope)}
                  />
                  <span>
                    <span className="font-medium text-primary">{item.title}</span>{" "}
                    {consent.scopes.requested.includes(item.scope) && (
                      <span className="text-11 text-tertiary">(запрошено приложением)</span>
                    )}
                    <span className="block text-12 text-secondary">{item.description}</span>
                  </span>
                </label>
              ))}
            </div>
            {!scopes.includes("read") && (
              <p role="alert" className="text-12 text-danger-primary">
                Нужно право «Чтение»: без него приложение не найдёт ни задачи, ни проекты.
              </p>
            )}
          </fieldset>

          <p className="text-12 text-tertiary">
            Доступ можно отозвать в любой момент: Настройки профиля, «MCP для агентов». Если приложением не пользоваться{" "}
            {consent.access_days} дн., доступ закроется сам.
          </p>
        </>
      )}

      {error && (
        <p role="alert" className="text-13 text-danger-primary">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={isSubmitting !== null} onClick={() => void decide("deny")}>
          Отклонить
        </Button>
        <Button
          variant="primary"
          disabled={!canApprove || isSubmitting !== null}
          loading={isSubmitting === "approve"}
          onClick={() => void decide("approve")}
        >
          Разрешить
        </Button>
      </div>
    </Card>
  );
}

/**
 * The consent screen of the OAuth authorization server of the MCP server. An application (ChatGPT, ...) sends the
 * user here; the user chooses the scopes and workspaces, and the browser goes back to the application with a code.
 */
export function OAuthConsent(props: {
  requestId?: string | null;
  error?: string | null;
  errorDescription?: string | null;
}) {
  const { requestId, error, errorDescription } = props;
  const [finished, setFinished] = useState<{ approved: boolean } | null>(null);
  const { data, error: loadError } = useSWR(
    requestId && !error ? ["OAUTH_CONSENT", requestId] : null,
    () => mcpService.oauthConsent(requestId!),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  if (error) {
    return <Problem title="Не удалось подключить приложение" message={errorDescription || error} />;
  }
  if (!requestId) {
    return <Problem title="Не удалось подключить приложение" message="В адресе нет запроса на подключение." />;
  }
  if (loadError) {
    return <Problem title="Не удалось подключить приложение" message={errorText(loadError)} />;
  }
  if (!data) {
    return (
      <Card>
        <p className="text-13 text-tertiary">Загрузка…</p>
      </Card>
    );
  }
  if (finished) {
    return (
      <Card>
        <h1 className="text-18 font-semibold">{finished.approved ? "Готово" : "Подключение отклонено"}</h1>
        <p className="text-13 text-secondary">
          {finished.approved
            ? "Возвращаемся в приложение. Если окно не закрылось само, вернитесь в приложение вручную."
            : "Приложению ничего не передано. Это окно можно закрыть."}
        </p>
      </Card>
    );
  }
  return (
    <ConsentForm
      requestId={requestId}
      consent={data}
      onDone={(redirectUrl, approved) => {
        setFinished({ approved });
        window.location.assign(redirectUrl);
      }}
    />
  );
}
