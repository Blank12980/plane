/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
// gizmo imports
import type { IWorkspaceMemberInvitation } from "@plane/types";
import { EOnboardingSteps } from "@plane/types";
// local components
import { WorkspaceJoinInvitesStep } from "./join-invites";

type Props = {
  invitations: IWorkspaceMemberInvitation[];
  handleStepChange: (step: EOnboardingSteps) => void;
};

/**
 * Onboarding never offers to create a workspace: it is optional and is done later from the home panel.
 * The only workspace-related thing shown here is the list of pending invitations, if there are any.
 */
export const WorkspaceSetupStep = observer(function WorkspaceSetupStep({ invitations, handleStepChange }: Props) {
  const hasInvitations = invitations.length > 0;

  useEffect(() => {
    // Nothing to join - the step has no content, finish onboarding.
    if (!hasInvitations) handleStepChange(EOnboardingSteps.WORKSPACE_CREATE_OR_JOIN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInvitations]);

  if (!hasInvitations) return null;

  return (
    <WorkspaceJoinInvitesStep
      invitations={invitations}
      handleNextStep={async () => {
        handleStepChange(EOnboardingSteps.WORKSPACE_CREATE_OR_JOIN);
      }}
    />
  );
});
