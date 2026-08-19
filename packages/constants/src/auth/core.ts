/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TCoreLoginMediums } from "@plane/types";

export const CORE_LOGIN_MEDIUM_LABELS: Record<TCoreLoginMediums, string> = {
  email: "Email",
  "magic-code": "Код из письма",
  github: "GitHub",
  gitlab: "GitLab",
  google: "Google",
  gitea: "Gitea",
};
