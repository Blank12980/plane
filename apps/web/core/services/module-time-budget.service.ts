import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type TModuleTimeBudget = {
  month: string;
  limit_minutes: number | null;
  /** The time logged on sub-work-items of the module's work items counts as well. */
  include_subtasks: boolean;
  total_minutes: number;
  reached: boolean;
};

export type TModuleTimeBudgetUpdate = Partial<Pick<TModuleTimeBudget, "limit_minutes" | "include_subtasks">>;

class ModuleTimeBudgetService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  async fetchBudget(workspaceSlug: string, projectId: string, moduleId: string): Promise<TModuleTimeBudget> {
    return (await this.get(`/api/workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}/time-budget/`))
      .data;
  }

  async updateBudget(
    workspaceSlug: string,
    projectId: string,
    moduleId: string,
    update: TModuleTimeBudgetUpdate
  ): Promise<TModuleTimeBudget> {
    return (
      await this.patch(
        `/api/workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}/time-budget/`,
        update
      )
    ).data;
  }
}

export const moduleTimeBudgetService = new ModuleTimeBudgetService();
