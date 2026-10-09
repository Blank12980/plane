/**
 * Copyright (c) 2023-present Gizmo Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { TimeInput } from "./time-input";

const meta: Meta<typeof TimeInput> = {
  title: "TimeInput",
  component: TimeInput,
  args: { label: "Deadline time", clearLabel: "Remove time", onError: console.error },
};
export default meta;
type Story = StoryObj<typeof TimeInput>;

export const Default: Story = {
  render: function Example(args) {
    const [value, setValue] = useState<string | null>("18:00");
    return <TimeInput {...args} value={value} onCommit={async (next) => setValue(next)} />;
  },
};

export const Empty: Story = { args: { value: null, onCommit: async () => undefined } };
export const Disabled: Story = { args: { value: "18:00", disabled: true, onCommit: async () => undefined } };
