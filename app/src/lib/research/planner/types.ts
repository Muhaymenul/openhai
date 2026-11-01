export interface PlannerTask {
  id: string;
  title: string;
  dueAt: string;
  paperId?: string;
  priority: "high" | "normal" | "low";
  status: "todo" | "done" | "archived";
  version: number;
  createdAt: string;
  updatedAt: string;
}
