-- Executed only on the initial empty PostgreSQL volume.
-- Read the secret from the environment; it is not checked into the SQL file.
\getenv runtime_password POSTGRES_RUNTIME_PASSWORD
CREATE ROLE dentaflow_runtime LOGIN PASSWORD :'runtime_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE dentaflow TO dentaflow_runtime;
GRANT USAGE ON SCHEMA public TO dentaflow_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE dentaflow_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dentaflow_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE dentaflow_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO dentaflow_runtime;
