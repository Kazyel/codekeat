import Image from "next/image";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { BrandLockup } from "../brand-lockup";

import { readSession } from "../lib/session";

interface LoginPageProperties {
	readonly searchParams: Promise<{ readonly error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProperties): Promise<ReactNode> {
	if ((await readSession()) !== null) {
		redirect("/dashboard");
	}

	const { error } = await searchParams;
	return (
		<main className="auth-shell">
			<section className="login-frame" aria-labelledby="login-title">
				<div className="login-brand">
					<BrandLockup />
					<div className="login-brand-copy">
						<p className="login-promise">Review sem ruído.</p>
						<p>Findings concretos para orientar a revisão humana.</p>
					</div>
					<Image
						alt=""
						aria-hidden="true"
						className="login-mark"
						height={420}
						priority
						src="/codekeat.svg"
						width={420}
					/>
				</div>
				<div className="login-card">
					<p className="eyebrow">Acesso interno</p>
					<h1 id="login-title">Entre no painel</h1>
					<p className="login-copy">
						Use as credenciais fornecidas pelo administrador do Codekeat.
					</p>
					{error === "invalid_credentials" ? (
						<p className="form-error" role="alert">
							E-mail ou senha inválidos.
						</p>
					) : null}
					<form action="/login/submit" className="login-form" method="post">
						<label htmlFor="email">E-mail</label>
						<input autoComplete="email" id="email" name="email" required type="email" />
						<label htmlFor="password">Senha</label>
						<input
							autoComplete="current-password"
							id="password"
							minLength={8}
							name="password"
							required
							type="password"
						/>
						<button type="submit">Entrar no painel</button>
					</form>
				</div>
			</section>
		</main>
	);
}
