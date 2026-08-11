import type { WebhookStore } from "@codekeat/database";
import type { Context } from "probot";

import { type DeliveryOutcome, processWebhookDelivery } from "./webhook-delivery.js";

type InstallationEventName =
  | "installation.created"
  | "installation.suspend"
  | "installation.unsuspend"
  | "installation.deleted"
  | "installation_repositories.added"
  | "installation_repositories.removed";

type InstallationContext = Context<InstallationEventName>;

interface InstallationDependencies {
  readonly store: WebhookStore;
  readonly allowedOrganizations: ReadonlySet<string>;
}

interface GitHubRepository {
  readonly id: number;
  readonly name: string;
  readonly full_name: string;
}

export async function handleInstallationCreated(
  context: Context<"installation.created">,
  dependencies: InstallationDependencies,
): Promise<void> {
  await processWebhookDelivery(dependencies.store, deliveryFor(context), async () => {
    const installation = context.payload.installation;

    const organizationLogin = allowedOrganization(
      context.payload.organization?.login,
      dependencies,
    );
    if (organizationLogin === null) {
      return ignored("organization_not_allowed");
    }

    dependencies.store.upsertInstallation({
      githubInstallationId: installation.id,
      organizationLogin,
      status: "active",
    });

    upsertRepositories(context.payload.repositories ?? [], installation.id, dependencies.store);
    return handled();
  });
}

export async function handleInstallationSuspended(
  context: Context<"installation.suspend">,
  dependencies: InstallationDependencies,
): Promise<void> {
  await updateInstallationStatus(context, dependencies, "suspended");
}

export async function handleInstallationUnsuspended(
  context: Context<"installation.unsuspend">,
  dependencies: InstallationDependencies,
): Promise<void> {
  await processWebhookDelivery(dependencies.store, deliveryFor(context), async () => {
    const installation = context.payload.installation;
    const organizationLogin = allowedOrganization(
      context.payload.organization?.login,
      dependencies,
    );

    if (organizationLogin === null) {
      return ignored("organization_not_allowed");
    }

    dependencies.store.upsertInstallation({
      githubInstallationId: installation.id,
      organizationLogin,
      status: "active",
    });
    return handled();
  });
}

export async function handleInstallationDeleted(
  context: Context<"installation.deleted">,
  dependencies: InstallationDependencies,
): Promise<void> {
  await updateInstallationStatus(context, dependencies, "deleted");
}

export async function handleRepositoriesAdded(
  context: Context<"installation_repositories.added">,
  dependencies: InstallationDependencies,
): Promise<void> {
  await processWebhookDelivery(dependencies.store, deliveryFor(context), async () => {
    const installation = dependencies.store.findInstallation(context.payload.installation.id);
    if (installation?.status !== "active") {
      return ignored("installation_not_active");
    }

    upsertRepositories(
      context.payload.repositories_added,
      context.payload.installation.id,
      dependencies.store,
    );
    return handled();
  });
}

export async function handleRepositoriesRemoved(
  context: Context<"installation_repositories.removed">,
  dependencies: InstallationDependencies,
): Promise<void> {
  await processWebhookDelivery(dependencies.store, deliveryFor(context), async () => {
    const installation = dependencies.store.findInstallation(context.payload.installation.id);
    if (installation === null) {
      return ignored("installation_not_active");
    }

    for (const repository of context.payload.repositories_removed) {
      dependencies.store.setRepositoryStatus(repository.id, "removed");
    }

    return handled();
  });
}

async function updateInstallationStatus(
  context: Context<"installation.suspend" | "installation.deleted">,
  dependencies: InstallationDependencies,
  status: "suspended" | "deleted",
): Promise<void> {
  await processWebhookDelivery(dependencies.store, deliveryFor(context), async () => {
    dependencies.store.setInstallationStatus(context.payload.installation.id, status);
    return handled();
  });
}

function deliveryFor(context: InstallationContext): {
  deliveryId: string;
  eventName: string;
  installationId: number;
} {
  return {
    deliveryId: context.id,
    eventName: context.name,
    installationId: context.payload.installation.id,
  };
}

function allowedOrganization(
  organizationLogin: string | undefined,
  dependencies: InstallationDependencies,
): string | null {
  if (organizationLogin === undefined) {
    return null;
  }

  return dependencies.allowedOrganizations.has(organizationLogin.toLowerCase())
    ? organizationLogin
    : null;
}

function upsertRepositories(
  githubRepositories: readonly GitHubRepository[],
  installationId: number,
  store: WebhookStore,
): void {
  for (const repository of githubRepositories) {
    store.upsertRepository({
      githubRepositoryId: repository.id,
      installationId,
      ownerLogin: ownerFromFullName(repository.full_name),
      name: repository.name,
      defaultBranch: "unknown",
      status: "active",
    });
  }
}

function ownerFromFullName(fullName: string): string {
  const separatorIndex = fullName.indexOf("/");
  return fullName.slice(0, separatorIndex);
}

function handled(): DeliveryOutcome {
  return { kind: "handled" };
}

function ignored(reasonCode: string): DeliveryOutcome {
  return { kind: "ignored", reasonCode };
}
