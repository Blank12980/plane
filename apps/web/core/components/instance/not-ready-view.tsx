/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import Link from "next/link";
import { GOD_MODE_URL } from "@plane/constants";
// assets
import DefaultLayout from "@/layouts/default-layout";
import { PlaneLockup, PlaneLogo } from "@plane/propel/icons";
import { Button } from "@plane/propel/button";

export function InstanceNotReady() {
  return (
    <DefaultLayout>
      <div className="relative z-10 flex h-screen w-screen overflow-hidden">
        {/* Background decorations */}
        <div className="pointer-events-none absolute -top-24 -left-32 opacity-15" aria-hidden="true">
          <PlaneLogo className="h-56 w-auto text-primary" />
        </div>
        <div className="pointer-events-none absolute -right-20 -bottom-16 opacity-15" aria-hidden="true">
          <PlaneLogo className="h-56 w-auto text-primary" />
        </div>
        {/* Main content */}
        <div className="flex h-full w-full flex-col items-center px-8 pt-6 pb-10">
          <div className="sticky top-0 flex w-full shrink-0 items-center justify-between gap-6">
            <PlaneLockup className="h-9 w-auto text-primary" />
          </div>
          <div className="flex h-full w-full flex-col items-center justify-center gap-7">
            <div className="flex flex-col items-center gap-11">
              <PlaneLogo className="h-24 w-auto text-primary" />
              <div className="flex max-w-124 flex-col items-center gap-3">
                <h1 className="text-h2-semibold text-primary">Добро пожаловать в Gizmo</h1>
                <p className="text-center text-body-md-regular text-secondary">
                  Настройте экземпляр и создайте своё первое рабочее пространство, чтобы начать управлять проектами и
                  работой.
                </p>
              </div>
            </div>
            <a href={GOD_MODE_URL} className="w-72">
              <Button variant="primary" className="w-full" size="xl">
                Начать
              </Button>
            </a>
          </div>
        </div>
      </div>
    </DefaultLayout>
  );
}
