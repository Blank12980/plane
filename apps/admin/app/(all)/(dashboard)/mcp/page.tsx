/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import { cn } from "@plane/utils";
// components
import { PageWrapper } from "@/components/common/page-wrapper";
// types
import type { Route } from "./+types/page";
// local
import { McpActivityTab } from "./activity-tab";
import { McpGuideTab } from "./guide-tab";
import { McpOverviewTab } from "./overview-tab";
import { McpTokensTab } from "./tokens-tab";

type TTab = "overview" | "tokens" | "activity" | "guide";

const TABS: { key: TTab; label: string }[] = [
  { key: "overview", label: "Обзор и политика" },
  { key: "tokens", label: "Токены" },
  { key: "activity", label: "Журнал вызовов" },
  { key: "guide", label: "Руководство" },
];

function McpPage(_props: Route.ComponentProps) {
  const [activeTab, setActiveTab] = useState<TTab>("overview");

  return (
    <PageWrapper
      header={{
        title: "MCP для AI-агентов",
        description:
          "Через MCP-сервер агенты (Cursor, Claude и другие) работают с Gizmo от имени пользователя: читают и создают задачи, комментируют, планируют и списывают время. Здесь вы включаете сервер, задаёте правила для токенов и контролируете их использование.",
      }}
    >
      <div className="mb-6 flex items-center gap-1 border-b border-subtle">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn("-mb-px border-b-2 px-4 py-2 text-13 transition-colors", {
              "border-primary text-primary": activeTab === tab.key,
              "border-transparent text-tertiary hover:text-secondary": activeTab !== tab.key,
            })}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && <McpOverviewTab />}
      {activeTab === "tokens" && <McpTokensTab />}
      {activeTab === "activity" && <McpActivityTab />}
      {activeTab === "guide" && <McpGuideTab />}
    </PageWrapper>
  );
}

export const meta: Route.MetaFunction = () => [{ title: "MCP - God Mode" }];

export default McpPage;
