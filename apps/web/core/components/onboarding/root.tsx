/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react";
// gizmo imports
import { TOAST_TYPE, setToast } from "@plane/propel/toast";
import type { IWorkspaceMemberInvitation, TOnboardingStep, TOnboardingSteps, TUserProfile } from "@plane/types";
import { EOnboardingSteps } from "@plane/types";
// hooks
import { useWorkspace } from "@/hooks/store/use-workspace";
import { useUser, useUserProfile } from "@/hooks/store/user";
// local components
import { OnboardingHeader } from "./header";
import { OnboardingStepRoot } from "./steps";

type Props = {
  invitations?: IWorkspaceMemberInvitation[];
};

export const OnboardingRoot = observer(function OnboardingRoot({ invitations = [] }: Props) {
  const [currentStep, setCurrentStep] = useState<TOnboardingStep>(EOnboardingSteps.PROFILE_SETUP);
  // store hooks
  const { data: user } = useUser();
  const { data: userProfile, updateUserProfile, finishUserOnboarding } = useUserProfile();
  const { workspaces } = useWorkspace();

  const workspacesList = Object.values(workspaces ?? {});

  // Creating a workspace is never offered during onboarding (it is optional and lives on the home panel).
  // The only workspace-related step is accepting pending invitations, and only for users without a workspace.
  const hasInvitations = invitations.length > 0 && workspacesList.length === 0;

  // complete onboarding
  const finishOnboarding = useCallback(async () => {
    if (!user) return;
    try {
      await finishUserOnboarding();
    } catch (_error) {
      setToast({
        type: TOAST_TYPE.ERROR,
        title: "Не удалось",
        message: "Не удалось завершить онбординг. Попробуйте позже.",
      });
    }
  }, [user, finishUserOnboarding]);

  // handle step change
  const stepChange = useCallback(
    async (steps: Partial<TOnboardingSteps>) => {
      if (!user) return;

      const payload: Partial<TUserProfile> = {
        onboarding_step: {
          ...userProfile.onboarding_step,
          ...steps,
        },
      };

      await updateUserProfile(payload);
    },
    [user, userProfile, updateUserProfile]
  );

  const handleStepChange = useCallback(
    (step: EOnboardingSteps) => {
      switch (step) {
        case EOnboardingSteps.PROFILE_SETUP:
          setCurrentStep(EOnboardingSteps.ROLE_SETUP);
          break;
        case EOnboardingSteps.ROLE_SETUP:
          setCurrentStep(EOnboardingSteps.USE_CASE_SETUP);
          break;
        case EOnboardingSteps.USE_CASE_SETUP:
          // Saving the step and finishing onboarding are separate profile updates: keep them in order so the
          // older "profile_complete only" payload can never overwrite the final state.
          void (async () => {
            await stepChange({ profile_complete: true });
            if (hasInvitations) setCurrentStep(EOnboardingSteps.WORKSPACE_CREATE_OR_JOIN);
            else await finishOnboarding();
          })();
          break;
        case EOnboardingSteps.WORKSPACE_CREATE_OR_JOIN:
          void finishOnboarding();
          break;
      }
    },
    [stepChange, finishOnboarding, hasInvitations]
  );

  const updateCurrentStep = (step: EOnboardingSteps) => setCurrentStep(step);

  useEffect(() => {
    // A profile that was completed earlier only has the optional invitations step left.
    if (!userProfile?.onboarding_step?.profile_complete) return;
    if (hasInvitations) setCurrentStep(EOnboardingSteps.WORKSPACE_CREATE_OR_JOIN);
    else void finishOnboarding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Header with progress */}
      <OnboardingHeader
        currentStep={currentStep}
        updateCurrentStep={updateCurrentStep}
        hasInvitations={hasInvitations}
      />

      {/* Main content area */}
      <OnboardingStepRoot currentStep={currentStep} invitations={invitations} handleStepChange={handleStepChange} />
    </div>
  );
});
