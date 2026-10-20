/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import useSWR from "swr";
// gizmo imports
import { McpService } from "@plane/services";
import { Loader } from "@plane/ui";
import { cn } from "@plane/utils";

const mcpService = new McpService();

export function McpActivityTab() {
  const { data, error, isLoading } = useSWR("MCP_ACTIVITY", () => mcpService.adminActivity(100), {
    refreshInterval: 15_000,
  });

  if (isLoading) {
    return (
      <Loader className="space-y-3">
        <Loader.Item height="40px" />
        <Loader.Item height="40px" />
      </Loader>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-13 text-danger-primary">
        Не удалось загрузить журнал.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-13 text-secondary">
        Последние вызовы инструментов за 7 дней. В журнале только имя инструмента, статус и время; токены и содержимое
        запросов не показываются. Журнал доступен, пока запросы API сохраняются в PostgreSQL.
      </p>
      {data && data.length > 0 ? (
        <div className="overflow-hidden rounded-md border border-subtle">
          <table className="w-full text-13">
            <thead className="bg-layer-1 text-tertiary">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Время</th>
                <th className="px-4 py-2 text-left font-medium">Инструмент</th>
                <th className="px-4 py-2 text-left font-medium">Запрос</th>
                <th className="px-4 py-2 text-left font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {data.map((call) => (
                <tr key={call.id} className="text-primary">
                  <td className="px-4 py-2 text-secondary">{new Date(call.created_at).toLocaleString("ru-RU")}</td>
                  <td className="px-4 py-2 font-medium">{call.tool ?? "—"}</td>
                  <td className="max-w-80 truncate px-4 py-2 text-secondary" title={`${call.method} ${call.path}`}>
                    {call.method} {call.path}
                  </td>
                  <td className={cn("px-4 py-2", call.status >= 400 ? "text-danger-primary" : "text-success-primary")}>
                    {call.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded-md border border-subtle px-4 py-10 text-center text-13 text-tertiary">
          За последние 7 дней вызовов не было.
        </div>
      )}
    </div>
  );
}
