import { create } from 'zustand';
import type { AppStatus, JobType, Priority } from '../types';

interface FiltersState {
  statuses: AppStatus[];
  companyId?: number;
  jobType?: JobType;
  priority?: Priority;
  keyword: string;
  sortBy: 'updatedAt' | 'appliedAt' | 'deadline';
  sortOrder: 'asc' | 'desc';
  page: number;
  pageSize: number;
  set: (patch: Partial<FiltersState>) => void;
  reset: () => void;
}

const defaults: Omit<FiltersState, 'set' | 'reset'> = {
  statuses: [],
  companyId: undefined,
  jobType: undefined,
  priority: undefined,
  keyword: '',
  sortBy: 'updatedAt',
  sortOrder: 'desc',
  page: 1,
  pageSize: 20,
};

export const useFiltersStore = create<FiltersState>((set) => ({
  ...defaults,
  set: (patch) =>
    set((state) => ({
      ...patch,
      // 筛选条件变化时重置页码
      page:
        patch.page ??
        (patch.statuses !== undefined ||
        patch.keyword !== undefined ||
        patch.companyId !== undefined ||
        patch.jobType !== undefined ||
        patch.priority !== undefined ||
        patch.sortBy !== undefined ||
        patch.sortOrder !== undefined
          ? 1
          : state.page),
    })),
  reset: () => set({ ...defaults }),
}));
