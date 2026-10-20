/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// components
import { observer } from "mobx-react";
import { Mail } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTranslation } from "@plane/i18n";
import { cn } from "@plane/utils";
import { TopNavPowerK } from "@/components/navigation";
import { HelpMenuRoot } from "@/components/workspace/sidebar/help-section/root";
import { UserMenuRoot } from "@/components/workspace/sidebar/user-menu-root";
import { WorkspaceMenuRoot } from "@/components/workspace/sidebar/workspace-menu-root";
import { useAppRailPreferences } from "@/hooks/use-navigation-preferences";
import { Tooltip } from "@plane/propel/tooltip";
import { AppSidebarItem } from "@/components/sidebar/sidebar-item";
import { CommentFillIcon } from "@plane/propel/icons";
import { NotificationBell } from "@/components/workspace-notifications/notification-bell";
// local imports

export const TopNavigationRoot = observer(function TopNavigationRoot() {
  // router
  const pathname = usePathname();
  const { t } = useTranslation();

  // store hooks
  const { preferences } = useAppRailPreferences();

  const showLabel = preferences.displayMode === "icon_with_label";

  return (
    <div
      className={cn("z-[27] flex min-h-10 w-full items-center bg-canvas px-3.5 transition-all duration-300", {
        "px-2": !showLabel,
      })}
    >
      {/* Workspace Menu */}
      <div className="flex-1 shrink-0">
        <WorkspaceMenuRoot variant="top-navigation" />
      </div>
      {/* Power K Search */}
      <div className="shrink-0">
        <TopNavPowerK />
      </div>
      {/* Additional Actions */}
      <div className="flex flex-1 shrink-0 items-center justify-end gap-1">
        <Tooltip tooltipContent="Мессенджер" position="bottom">
          <AppSidebarItem
            variant="link"
            item={{
              href: "/messanger/",
              icon: (
                <div className="relative">
                  <CommentFillIcon className="size-5" />
                </div>
              ),
              isActive: pathname?.includes("/messenger/") || pathname?.includes("/messanger"),
            }}
          />
        </Tooltip>
        <NotificationBell />
        <Tooltip tooltipContent={t("mail_nav")} position="bottom">
          <AppSidebarItem
            variant="link"
            item={{
              href: "/mail",
              icon: <Mail className="size-5" />,
              isActive: pathname?.startsWith("/mail"),
            }}
          />
        </Tooltip>
        <HelpMenuRoot />
        <div className="flex size-8 items-center justify-center rounded-md hover:bg-layer-1-hover">
          <UserMenuRoot />
        </div>
      </div>
    </div>
  );
});
