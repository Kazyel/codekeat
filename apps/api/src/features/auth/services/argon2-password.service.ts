import argon2 from "argon2";
const PASSWORD_HASH_OPTIONS = {
	type: argon2.argon2id,
	memoryCost: 19_456,
	timeCost: 2,
	parallelism: 1,
	hashLength: 32,
} as const;

export class Argon2PasswordService {
	hash(password: string): Promise<string> {
		return argon2.hash(password, PASSWORD_HASH_OPTIONS);
	}

	verify(passwordHash: string, password: string): Promise<boolean> {
		return argon2.verify(passwordHash, password);
	}
}
