import { createHash, randomBytes, randomUUID } from "node:crypto";

import type {
  AuthenticatedDashboardUser,
  DashboardUserCredentials,
  WebhookStore,
} from "@codekeat/database";

export interface DashboardCredentials {
  readonly email: string;
  readonly password: string;
}

export interface InitialDashboardAdmin extends DashboardCredentials {}

export interface DashboardSession {
  readonly token: string;
  readonly user: AuthenticatedDashboardUser;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
}

export class DashboardAuthenticator {
  constructor(
    private readonly store: WebhookStore,
    private readonly passwordHasher: PasswordHasher,
  ) {}

  async provisionInitialAdmin(admin: InitialDashboardAdmin): Promise<void> {
    if (this.store.findDashboardUserCredentials(admin.email) !== null) {
      return;
    }

    const passwordHash = await this.passwordHasher.hash(admin.password);
    this.store.createDashboardUserIfMissing({
      id: randomUUID(),
      email: admin.email,
      passwordHash,
      role: "admin",
    });
  }

  async createSession(credentials: DashboardCredentials): Promise<DashboardSession | null> {
    const user = this.store.findDashboardUserCredentials(credentials.email);
    if (
      user === null ||
      !(await passwordMatches(user, credentials.password, this.passwordHasher))
    ) {
      return null;
    }

    const token = randomBytes(32).toString("base64url");
    this.store.createDashboardSession({
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt: sessionExpiry(),
    });

    return { token, user: withoutPasswordHash(user) };
  }

  readSession(token: string): AuthenticatedDashboardUser | null {
    return this.store.findAuthenticatedDashboardUser(
      hashSessionToken(token),
      new Date().toISOString(),
    );
  }

  deleteSession(token: string): void {
    this.store.deleteDashboardSession(hashSessionToken(token));
  }
}

async function passwordMatches(
  user: DashboardUserCredentials,
  password: string,
  passwordHasher: PasswordHasher,
): Promise<boolean> {
  return passwordHasher.verify(user.passwordHash, password);
}

function withoutPasswordHash(user: DashboardUserCredentials): AuthenticatedDashboardUser {
  return { id: user.id, email: user.email, role: user.role };
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function sessionExpiry(): string {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
}
