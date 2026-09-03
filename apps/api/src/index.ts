import type { ApplicationFunctionOptions, Probot } from "probot";

import { configureApplication } from "./bootstrap/application.js";
import { loadEnvironment } from "./bootstrap/environment.js";

export default async function codekeat(
	app: Probot,
	options: ApplicationFunctionOptions,
): Promise<void> {
	await configureApplication(app, loadEnvironment(process.env), options);
}
