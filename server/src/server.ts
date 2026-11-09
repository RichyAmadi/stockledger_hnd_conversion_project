import { buildApp } from "./app";
import { migrateDatabase } from "./migrate";

const port = Number(process.env.PORT ?? 4000);

async function start() {
	await migrateDatabase();
	buildApp().listen(port, () => console.log(`API listening on :${port}`));
}

start().catch((error) => {
	console.error("Database migration failed", error);
	process.exitCode = 1;
});
