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

function LoginPage() {
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
		<main className="relative grid min-h-svh overflow-hidden lg:grid-cols-[1.1fr_0.9fr]">
			<section className="relative hidden overflow-hidden bg-foreground p-10 text-white lg:flex lg:flex-col lg:justify-between">
				<div className="absolute inset-x-0 bottom-0 h-2 bg-primary" />
				<div className="absolute inset-x-0 bottom-2 h-1 bg-accent" />
				<div className="relative flex items-center gap-3">
					<BrandMark />
					<span className="text-sm font-semibold text-white">Codekeat</span>
				</div>
				<div className="relative max-w-xl pb-12">
					<h1 className="font-['Pixelify_Sans'] text-6xl font-semibold leading-[0.92] tracking-[-0.035em]">
						Código melhor.
						<br />
						Sinal mais claro.
					</h1>
					<p className="mt-6 max-w-md text-[0.95rem] leading-6 text-white/60">
						Acompanhe cada review consultiva, entenda custos e avalie a qualidade dos
						findings em um único pulso.
					</p>
				</div>
				<p className="relative text-sm font-medium text-white/60">
					GitHub → Gemini + MCP → relatório consultivo
				</p>
			</section>
			<section className="grid place-items-center border-l-[5px] border-accent bg-card/90 px-5 py-12 sm:px-10">
				<div className="w-full max-w-sm">
					<div className="mb-9 lg:hidden">
						<BrandMark className="size-10" />
					</div>
					<h2 className="font-['Pixelify_Sans'] text-3xl font-semibold leading-tight tracking-[-0.025em]">
						Acesse o painel
					</h2>
					<p className="mt-2 text-sm text-muted-foreground">
						Use as credenciais provisionadas pela API.
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
												spellCheck={false}
												id={field.name}
												name={field.name}
												onBlur={field.handleBlur}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
												placeholder="Ex.: voce@empresa.com…"
												type="email"
												value={field.state.value}
											/>
											{invalid ? (
												<FieldError errors={field.state.meta.errors} />
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
												<FieldError errors={field.state.meta.errors} />
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
									className="mt-6 w-full justify-between"
									disabled={!canSubmit || isSubmitting}
									type="submit"
								>
									<span>{isSubmitting ? "Validando…" : "Entrar"}</span>
									<ArrowRight aria-hidden="true" />
								</Button>
							)}
						</form.Subscribe>
					</form>
				</div>
			</section>
		</main>
	);
}
