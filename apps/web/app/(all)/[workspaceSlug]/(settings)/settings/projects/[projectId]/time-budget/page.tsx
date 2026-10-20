/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { observer } from "mobx-react";
// gizmo imports
import { EUserPermissions, EUserPermissionsLevel } from "@plane/constants";
import { useTranslation } from "@plane/i18n";
// components
import { NotAuthorizedView } from "@/components/auth-screens/not-authorized-view";
import { PageHead } from "@/components/core/page-title";
import { ProjectTimeBudget } from "@/components/project/settings/time-budget";
import { SettingsContentWrapper } from "@/components/settings/content-wrapper";
import { SettingsHeading } from "@/components/settings/heading";
// hooks
import { useProject } from "@/hooks/store/use-project";
import { useUserPermissions } from "@/hooks/store/user";
// local imports
import type { Route } from "./+types/page";
import { TimeBudgetProjectSettingsHeader } from "./header";

function TimeBudgetSettingsPage({ params }: Route.ComponentProps) {
  // router
  const { workspaceSlug, projectId } = params;
  // store hooks
  const { t } = useTranslation();
  const { currentProjectDetails } = useProject();
  const { workspaceUserInfo, allowPermissions } = useUserPermissions();
  // derived values
  const canEdit = allowPermissions([EUserPermissions.ADMIN], EUserPermissionsLevel.PROJECT);
  const canView = canEdit || allowPermissions([EUserPermissions.MEMBER], EUserPermissionsLevel.PROJECT);
  const pageTitle = currentProjectDetails?.name
    ? `${currentProjectDetails.name} - ${t("gizmo_settings.time_budget")}`
    : undefined;

  if (workspaceUserInfo && !canView) {
    return <NotAuthorizedView section="settings" isProjectView className="h-auto" />;
  }

  return (
    <SettingsContentWrapper header={<TimeBudgetProjectSettingsHeader />} hugging>
      <PageHead title={pageTitle} />
      <SettingsHeading title="Месячный лимит часов проекта" />
      <div className="mt-6">
        <ProjectTimeBudget workspaceSlug={workspaceSlug} projectId={projectId} disabled={!canEdit} />
      </div>
    </SettingsContentWrapper>
  );
}

export default observer(TimeBudgetSettingsPage);
