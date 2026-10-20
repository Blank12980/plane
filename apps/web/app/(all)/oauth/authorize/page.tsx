/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useEffect } from "react";
import { observer } from "mobx-react";
import { useSearchParams } from "next/navigation";
// components
import { LogoSpinner } from "@/components/common/logo-spinner";
import { OAuthConsent } from "@/components/oauth/consent";
// helpers
import { EPageTypes } from "@/helpers/authentication.helper";
// hooks
import { useUser } from "@/hooks/store/user";
// wrappers
import { AuthenticationWrapper } from "@/lib/wrappers/authentication-wrapper";

/** The sign-in page only keeps the path, so the whole address (with the request id) is handed over in next_path. */
function OAuthAuthorize() {
  const searchParams = useSearchParams();
  const { data: currentUser } = useUser();
  const isSignedIn = Boolean(currentUser?.id);

  useEffect(() => {
    if (isSignedIn) return;
    const target = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`/?next_path=${encodeURIComponent(target)}`);
  }, [isSignedIn]);

  if (!isSignedIn) {
    return (
      <div className="relative flex h-screen w-full items-center justify-center">
        <LogoSpinner />
      </div>
    );
  }
  return (
    <OAuthConsent
      requestId={searchParams.get("request")}
      error={searchParams.get("error")}
      errorDescription={searchParams.get("error_description")}
    />
  );
}

function OAuthAuthorizePage() {
  return (
    <AuthenticationWrapper pageType={EPageTypes.PUBLIC}>
      <OAuthAuthorize />
    </AuthenticationWrapper>
  );
}

export default observer(OAuthAuthorizePage);
