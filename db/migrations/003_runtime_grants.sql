GRANT USAGE ON SCHEMA public TO openwarp_app;
GRANT SELECT ON "user", workspace_members TO openwarp_app;
GRANT SELECT, UPDATE (password, "updatedAt") ON "account" TO openwarp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "session", "rateLimit" TO openwarp_app;
GRANT SELECT, INSERT, UPDATE ON teams, employees, employee_workflows, workflow_tasks TO openwarp_app;
GRANT SELECT, INSERT ON activity_log TO openwarp_app;
