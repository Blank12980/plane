/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import useSWR from "swr";
import { Ban, RotateCcw, Trash2 } from "lucide-react";
// gizmo imports
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import { McpService } from "@plane/services";
import type { TMcpToken } from "@plane/types";
import { Loader } from "@plane/ui";
import { cn } from "@plane/utils";
// local
import { ConfirmModal } from "../mail/confirm-modal";

const mcpService = new McpService();

const formatDate = (value: string | null) => (value ? new Date(value).toLocaleString("ru-RU") : "—");

const statusOf = (token: TMcpToken): { label: string; className: string } => {
  if (token.revoked) return { label: "отозван", className: "bg-danger-subtle text-danger-primary" };
  if (token.expired) return { label: "истёк", className: "bg-layer-2 text-tertiary" };
  return { label: "активен", className: "bg-success-subtle text-success-primary" };
};

export function McpTokensTab() {
  const { data, error, isLoading, mutate } = useSWR("MCP_TOKENS", () => mcpService.adminTokens());
  const [deleting, setDeleting] = useState<TMcpToken | null>(null);

  const setActive = async (token: TMcpToken, isActive: boolean) => {
    try {
      await mcpService.adminSetTokenActive(token.id, isActive);
      setToast({
        type: TOAST_TYPE.SUCCESS,
        title: "Готово",
        message: isActive ? "Токен снова действует." : "Токен отозван, агент потеряет доступ сразу.",
      });
      await mutate();
    } catch {
      setToast({ type: TOAST_TYPE.ERROR, title: "Ошибка", message: "Не удалось изменить токен." });
    }
  };

  if (isLoading) {
    return (
      <Loader className="space-y-3">
        <Loader.Item height="40px" />
        <Loader.Item height="40px" />
        <Loader.Item height="40px" />
      </Loader>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-13 text-danger-primary">
        Не удалось загрузить токены.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <ConfirmModal
        isOpen={Boolean(deleting)}
        title="Удалить токен"
        description={`Токен «${deleting?.label ?? ""}» пользователя ${deleting?.user.email ?? ""} будет удалён без возможности восстановления. Агент сразу потеряет доступ.`}
        handleClose={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await mcpService.adminDeleteToken(deleting.id);
          setToast({ type: TOAST_TYPE.SUCCESS, title: "Готово", message: "Токен удалён." });
          await mutate();
        }}
      />
      <p className="text-13 text-secondary">
        Все токены, созданные для MCP: пользователями в настройках профиля и администратором командой{" "}
        <code>create_agent_token</code>. Секрет токена в списке не отображается: пользователь видит его только один раз,
        при создании.
      </p>
      {data && data.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-subtle">
          <table className="w-full text-13">
            <thead className="bg-layer-1 text-tertiary">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Токен</th>
                <th className="px-4 py-2 text-left font-medium">Владелец</th>
                <th className="px-4 py-2 text-left font-medium">Пространство</th>
                <th className="px-4 py-2 text-left font-medium">Права</th>
                <th className="px-4 py-2 text-left font-medium">Использован</th>
                <th className="px-4 py-2 text-left font-medium">Срок</th>
                <th className="px-4 py-2 text-left font-medium">Статус</th>
                <th className="px-4 py-2 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {data.map((token) => {
                const status = statusOf(token);
                return (
                  <tr key={token.id} className="align-top text-primary">
                    <td className="px-4 py-2">
                      <div className="font-medium">{token.label}</div>
                      <div className="text-12 text-tertiary">{token.allowed_rate_limit}</div>
                    </td>
                    <td className="px-4 py-2">
                      <div>{token.user.display_name}</div>
                      <div className="text-12 text-tertiary">{token.user.email}</div>
                    </td>
                    <td className="px-4 py-2 text-secondary">{token.workspace?.name ?? "любое"}</td>
                    <td className="max-w-56 px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {token.scopes.length > 0 ? (
                          token.scopes.map((scope) => (
                            <code key={scope} className="rounded bg-layer-1 px-1 text-11">
                              {scope}
                            </code>
                          ))
                        ) : (
                          <span className="text-12 text-danger-primary">без ограничений</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-secondary">{formatDate(token.last_used)}</td>
                    <td className="px-4 py-2 text-secondary">
                      {token.expired_at ? formatDate(token.expired_at) : "бессрочный"}
                    </td>
                    <td className="px-4 py-2">
                      <span className={cn("rounded-full px-2 py-0.5 text-11", status.className)}>{status.label}</span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        {token.revoked ? (
                          <button
                            type="button"
                            title="Вернуть в работу"
                            className="rounded-sm p-1.5 text-tertiary hover:bg-layer-1-hover hover:text-primary"
                            onClick={() => void setActive(token, true)}
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="Отозвать"
                            className="rounded-sm p-1.5 text-tertiary hover:bg-layer-1-hover hover:text-primary"
                            onClick={() => void setActive(token, false)}
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          title="Удалить"
                          className="rounded-sm p-1.5 text-tertiary hover:bg-layer-1-hover hover:text-danger-primary"
                          onClick={() => setDeleting(token)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-md border border-subtle px-4 py-10 text-center text-13 text-tertiary">
          MCP-токенов пока нет. Пользователи создают их в настройках профиля, раздел «MCP для агентов».
        </div>
      )}
    </div>
  );
}
