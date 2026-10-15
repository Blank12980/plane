import { API_BASE_URL } from "@plane/constants";
import { APIService } from "@/services/api.service";

export type TModuleTimeBudget = {
  month: string;
  limit_minutes: number | null;
  total_minutes: number;
  reached: boolean;
};

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
    limitMinutes: number | null
  ): Promise<TModuleTimeBudget> {
    return (
      await this.patch(`/api/workspaces/${workspaceSlug}/projects/${projectId}/modules/${moduleId}/time-budget/`, {
        limit_minutes: limitMinutes,
      })
    ).data;
  }
}

export const moduleTimeBudgetService = new ModuleTimeBudgetService();
