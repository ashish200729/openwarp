-- The runtime role verifies the build's migration before serving traffic.
GRANT SELECT (name, checksum) ON schema_migrations TO openwarp_app;
