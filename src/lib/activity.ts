import { payActivity } from "./domains/pay";
import { platformActivity } from "./domains/platform";
import { recordsActivity } from "./domains/records";
import { timeActivity } from "./domains/time";
import { workplaceActivity } from "./domains/workplace";

export const activityLabels = {
  "employee.created": "Added an employee", "employee.updated": "Updated an employee", "employee.exported": "Exported the directory",
  "team.created": "Created a team", "team.updated": "Renamed a team", "workflow.started": "Started a checklist",
  "workflow.completed": "Completed a checklist", "workflow.cancelled": "Cancelled a checklist", "task.completed": "Completed a task",
  "task.reopened": "Reopened a task", "account.created": "Created an account", "account.role_changed": "Changed workspace access",
  "account.password_reset": "Reset an account password", "account.linked": "Linked an account to an employee",
  "employee.imported": "Imported employees", "compensation.added": "Recorded pay",
  "time_off.requested": "Requested time off", "time_off.approved": "Approved time off", "time_off.declined": "Declined time off", "time_off.cancelled": "Cancelled time off",
  "expense.submitted": "Submitted an expense", "expense.approved": "Approved an expense", "expense.declined": "Declined an expense", "expense.cancelled": "Cancelled an expense",
  "document.added": "Added a document", "document.archived": "Archived a document", "document.acknowledged": "Acknowledged a document",
  "pay_run.created": "Created a pay run", "pay_run.updated": "Changed a pay run", "pay_run.approved": "Approved a pay run", "pay_run.deleted": "Deleted a draft pay run", "pay_run.exported": "Exported a pay run",
  "settings.updated": "Changed workspace settings", "team.archived": "Archived a team",
  ...timeActivity, ...payActivity, ...recordsActivity, ...workplaceActivity, ...platformActivity,
} as const;
export type ActivityEvent = keyof typeof activityLabels;
