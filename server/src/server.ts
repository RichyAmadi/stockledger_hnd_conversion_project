import { buildApp } from "./app";
import { migrateDatabase } from "./migrate";
import { bootstrapPlatformAdmin } from "./platform-admin-bootstrap";

const port = Number(process.env.PORT ?? 4000);

async function start() {
	if (process.env.NODE_ENV === "production" || process.env.RUN_MIGRATIONS === "true") await migrateDatabase();
	await bootstrapPlatformAdmin();
	buildApp().listen(port, () => console.log(`API listening on :${port}`));
}

start().catch((error) => {
	console.error("Database migration failed", error);
	process.exitCode = 1;
});
