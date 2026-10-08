import type { Context, Probot } from "probot";
import { z } from "zod";

import type { WebhookDeliveryRepository } from "../repositories/webhook-delivery.repository.js";
import type { GitHubInstallationSyncService } from "../services/github-installation-sync.service.js";
import { processWebhookDelivery } from "../services/webhook-delivery.service.js";

const INSTALLATION_EVENTS = [
	"installation.created",
	"installation.suspend",
	"installation.unsuspend",
	"installation.deleted",
	"installation.new_permissions_accepted",
	"installation_repositories.added",
	"installation_repositories.removed",
	"repository.created",
	"repository.deleted",
	"repository.renamed",
	"repository.archived",
	"repository.unarchived",
	"repository.edited",
	"repository.transferred",
	"repository.privatized",
	"repository.publicized",
] as const;

const EVENT_SCHEMA = z.object({
	action: z.string().min(1),
	installation: z.object({ id: z.number().int().positive() }).optional(),
});

const INACTIVE_INSTALLATION_EVENTS: Readonly<Record<string, "suspended" | "deleted" | undefined>> =
	{
		"installation.suspend": "suspended",
		"installation.deleted": "deleted",
	};

interface InstallationDependencies {
	readonly installationSync: GitHubInstallationSyncService;
	readonly deliveryRepository: WebhookDeliveryRepository;
}

export function registerGitHubInstallationHandlers(
	app: Probot,
	dependencies: InstallationDependencies,
): void {
	app.on([...INSTALLATION_EVENTS], (context) => handleInstallationEvent(context, dependencies));
}

async function handleInstallationEvent(
	context: Context<(typeof INSTALLATION_EVENTS)[number]>,
	dependencies: InstallationDependencies,
): Promise<void> {
	const payload = EVENT_SCHEMA.parse(context.payload);
	const installationId = payload.installation?.id ?? null;
	const eventName = `${context.name}.${payload.action}`;
	await processWebhookDelivery(
		dependencies.deliveryRepository,
		{ deliveryId: context.id, eventName, installationId },
		async () => {
			if (installationId === null)
				return { kind: "ignored", reasonCode: "installation_missing" };
			const status = INACTIVE_INSTALLATION_EVENTS[eventName];
			if (status !== undefined) {
				dependencies.installationSync.deactivate(installationId, status);
				return { kind: "handled" };
			}
			return dependencies.installationSync.reconcile(installationId);
		},
	);
}
