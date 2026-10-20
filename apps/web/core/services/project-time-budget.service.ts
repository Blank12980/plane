import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type TProjectTimeBudget = {
  month: string;
  limit_minutes: number | null;
  /** Count the time logged on work items that belong to a module. */
  count_module_tasks: boolean;
  /** Count the time logged on the specific work items that are not part of any module. */
  count_other_tasks: boolean;
  include_subtasks: boolean;
  /** Minutes that count towards the limit (depends on the switches above). */
  total_minutes: number;
  module_minutes: number;
  other_minutes: number;
  reached: boolean;
};

export type TProjectTimeBudgetUpdate = Partial<
  Pick<TProjectTimeBudget, "limit_minutes" | "count_module_tasks" | "count_other_tasks" | "include_subtasks">
>;

class ProjectTimeBudgetService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async fetchBudget(workspaceSlug: string, projectId: string): Promise<TProjectTimeBudget> {
    return (await this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/time-budget/`)).data;
  }

  async updateBudget(
    workspaceSlug: string,
    projectId: string,
    update: TProjectTimeBudgetUpdate
  ): Promise<TProjectTimeBudget> {
    return (await this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/time-budget/`, update)).data;
  }
}

export const projectTimeBudgetService = new ProjectTimeBudgetService();
