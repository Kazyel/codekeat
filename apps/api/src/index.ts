import type { Probot } from "probot";

import { configureApplication } from "./bootstrap/application.js";
import { loadEnvironment } from "./bootstrap/environment.js";

export default function codekeat(app: Probot): void {
  configureApplication(app, loadEnvironment(process.env));
}
