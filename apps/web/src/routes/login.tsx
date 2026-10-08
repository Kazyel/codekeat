import { useForm } from "@tanstack/react-form";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getCurrentUserFn, loginFn } from "@/features/auth/auth.functions";
import { loginInputSchema } from "@/lib/api-contracts";

export const Route = createFileRoute("/login")({
	beforeLoad: async () => {
		if ((await getCurrentUserFn()) !== null) throw redirect({ to: "/" });
	},
	component: LoginPage,
});

function LoginPage(): React.JSX.Element {
	const router = useRouter();
	const [formError, setFormError] = useState<string | null>(null);
	const form = useForm({
		defaultValues: { email: "", password: "" },
		validators: { onSubmit: loginInputSchema },
		onSubmit: async ({ value }) => {
			setFormError(null);
			try {
				const result = await loginFn({ data: value });
				if (!result.ok) {
					setFormError(
						"E-mail ou senha inválidos. Verifique os dados e tente novamente.",
					);
					return;
				}
				await router.navigate({ to: "/" });
			} catch {
				setFormError(
					"O serviço de autenticação está indisponível. Tente novamente em instantes.",
				);
			}
		},
	});

	return (
		<main className="login-page relative flex min-h-svh flex-col px-6 py-7 sm:px-10 sm:py-9 lg:px-16">
			<header className="relative mx-auto flex w-full max-w-7xl items-center gap-3 text-white">
				<BrandMark className="size-11" />
				<span className="text-xl font-semibold tracking-tight">Codekeat</span>
			</header>
			<div className="relative mx-auto grid w-full max-w-7xl flex-1 items-center gap-10 py-12 lg:grid-cols-[1fr_440px] lg:gap-16 lg:py-16 xl:gap-28">
				<section aria-label="Sobre o Codekeat" className="max-w-xl text-white">
					<p className="mb-5 flex items-center gap-3 text-sm font-medium text-white/75">
						<span
							aria-hidden="true"
							className="h-5 w-1.5 bg-primary shadow-[5px_0_0_#fc6701]"
						/>
						Seu próximo review começa aqui
					</p>
					<h2 className="font-display text-[clamp(2.75rem,5.5vw,5.5rem)] font-medium leading-[1.08] tracking-[-0.03em]">
						Código melhor.
						<br />
						Sinal mais claro.
					</h2>
					<p className="mt-6 max-w-sm text-base leading-relaxed text-white/75">
						Reviews de código com IA, conectadas ao GitHub. Acompanhe os findings, a
						qualidade e o custo de cada execução.
					</p>
				</section>
				<section
					aria-labelledby="login-title"
					className="login-panel relative w-full rounded-2xl border-2 border-[var(--hard-shadow)] bg-card px-6 py-8 text-card-foreground shadow-[6px_6px_0_var(--hard-shadow)] sm:p-10"
				>
					<div
						aria-hidden="true"
						className="absolute -top-0.5 left-10 flex h-1.5 w-16 overflow-hidden"
					>
						<span className="w-10 bg-primary" />
						<span className="flex-1 bg-accent" />
					</div>
					<h1
						id="login-title"
						className="font-display text-4xl font-semibold leading-[1.08] tracking-[-0.02em]"
					>
						Entre no seu painel
					</h1>
					<p className="mt-3 text-base text-muted-foreground">
						Suas reviews, em um só lugar.
					</p>
					<form
						className="mt-8"
						onSubmit={(event) => {
							event.preventDefault();
							form.handleSubmit();
						}}
					>
						<FieldGroup>
							<form.Field name="email">
								{(field) => {
									const invalid =
										field.state.meta.isTouched && !field.state.meta.isValid;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor={field.name}>E-mail</FieldLabel>
											<Input
												autoComplete="email"
												aria-invalid={invalid}
												aria-describedby={
													invalid ? "email-error" : undefined
												}
												required
												spellCheck={false}
												id={field.name}
												name={field.name}
												onBlur={field.handleBlur}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
												placeholder="voce@empresa.com"
												type="email"
												value={field.state.value}
											/>
											{invalid ? (
												<FieldError
													id="email-error"
													errors={field.state.meta.errors}
												/>
											) : null}
										</Field>
									);
								}}
							</form.Field>
							<form.Field name="password">
								{(field) => {
									const invalid =
										field.state.meta.isTouched && !field.state.meta.isValid;
									return (
										<Field data-invalid={invalid}>
											<FieldLabel htmlFor={field.name}>Senha</FieldLabel>
											<Input
												autoComplete="current-password"
												aria-invalid={invalid}
												aria-describedby={
													invalid ? "password-error" : undefined
												}
												required
												id={field.name}
												name={field.name}
												onBlur={field.handleBlur}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
												type="password"
												value={field.state.value}
											/>
											{invalid ? (
												<FieldError
													id="password-error"
													errors={field.state.meta.errors}
												/>
											) : null}
										</Field>
									);
								}}
							</form.Field>
						</FieldGroup>
						{formError ? (
							<p className="mt-4 text-sm leading-5 text-destructive" role="alert">
								{formError}
							</p>
						) : null}
						<form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting]}>
							{([canSubmit, isSubmitting]) => (
								<Button
									className="mt-8 w-full justify-between"
									size="lg"
									aria-busy={isSubmitting}
									disabled={!canSubmit || isSubmitting}
									type="submit"
								>
									<span>{isSubmitting ? "Validando…" : "Entrar"}</span>
									<ArrowRight aria-hidden="true" />
								</Button>
							)}
						</form.Subscribe>
					</form>
					<p className="mt-7 text-sm text-muted-foreground">
						Precisa de acesso? Solicite suas credenciais ao administrador do Codekeat.
					</p>
				</section>
			</div>
			<footer className="relative mx-auto flex w-full max-w-7xl flex-col gap-2 text-sm text-white/65 sm:flex-row sm:items-center sm:justify-between">
				<p>Mais contexto para quem revisa. Mais confiança para quem entrega.</p>
				<p className="shrink-0">Reviews consultivas. A decisão é sua.</p>
			</footer>
		</main>
	);
}
