/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { PlaneLogo } from "@plane/propel/icons";

export function LogoSpinner() {
  return (
    <div className="flex items-center justify-center" role="status" aria-label="Загрузка">
      <PlaneLogo className="h-6 w-auto animate-pulse text-primary motion-reduce:animate-none sm:h-11" />
    </div>
  );
}
