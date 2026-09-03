import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { BrandLockup } from "../../brand-lockup";
import { type DashboardModel, loadModels } from "../../lib/api-client";
import { readSession, readSessionToken } from "../../lib/session";
import {
	createModelAction,
	selectModelAction,
	setModelEnabledAction,
	updateModelAction,
} from "./actions";

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
	invalid: "Revise os dados do modelo e tente novamente.",
	forbidden: "Sua conta não pode alterar o catálogo.",
	not_found: "O modelo não existe mais.",
	conflict: "A alteração conflita com o estado atual do catálogo.",
};

interface ModelsPageProperties {
	readonly searchParams: Promise<{ readonly error?: string; readonly saved?: string }>;
}

export default async function ModelsPage({
	searchParams,
}: ModelsPageProperties): Promise<ReactNode> {
	const [session, sessionToken] = await Promise.all([readSession(), readSessionToken()]);
	if (session === null || sessionToken === null) {
		redirect("/login");
	}

	const catalog = await loadModels(sessionToken);
	const query = await searchParams;
	const errorMessage = query.error === undefined ? undefined : ERROR_MESSAGES[query.error];
	const canManage = session.role === "admin";

	return (
		<main className="shell">
			<header className="masthead">
				<div className="page-title">
					<BrandLockup />
					<div>
						<p className="eyebrow">Configuração global</p>
						<h1>Modelos de review</h1>
					</div>
				</div>
				<div className="header-actions">
					<Link className="quiet-button" href="/dashboard">
						Reviews
					</Link>
					<form action="/logout" method="post">
						<button className="quiet-button" type="submit">
							Sair
						</button>
					</form>
				</div>
			</header>

			<section className="model-intro" aria-labelledby="catalog-title">
				<div>
					<p className="eyebrow">Catálogo Gemini</p>
					<h2 id="catalog-title">Modelo e tarifas por milhão de tokens</h2>
					<p>
						Novas reviews capturam o modelo selecionado e estas tarifas. Alterações não
						mudam runs existentes.
					</p>
				</div>
				{query.saved === "1" ? (
					<output className="form-success">Catálogo atualizado.</output>
				) : null}
				{errorMessage === undefined ? null : (
					<p className="form-error" role="alert">
						{errorMessage}
					</p>
				)}
			</section>

			<section className="model-list" aria-label="Modelos cadastrados">
				{catalog.map((model) => (
					<article className="model-card" key={model.id}>
						<div className="model-card-heading">
							<div>
								<p className="model-state">
									{model.selected
										? "Selecionado"
										: model.enabled
											? "Habilitado"
											: "Desabilitado"}
								</p>
								<h2>{model.displayName}</h2>
								<code>{model.apiName}</code>
							</div>
							{canManage ? <ModelActions model={model} /> : null}
						</div>

						{canManage ? (
							<form
								action={updateModelAction.bind(null, model.id)}
								className="model-form"
							>
								<ModelFields model={model} />
								<button className="primary-button" type="submit">
									Salvar alterações
								</button>
							</form>
						) : (
							<ModelPrices model={model} />
						)}
					</article>
				))}
			</section>

			{canManage ? (
				<section className="model-create" aria-labelledby="create-model-title">
					<p className="eyebrow">Novo modelo</p>
					<h2 id="create-model-title">Adicionar ao catálogo</h2>
					<form action={createModelAction} className="model-form">
						<ModelFields />
						<button className="primary-button" type="submit">
							Adicionar modelo
						</button>
					</form>
				</section>
			) : null}
		</main>
	);
}

function ModelActions({ model }: { readonly model: DashboardModel }): ReactNode {
	return (
		<div className="model-actions">
			{model.selected ? null : (
				<form action={selectModelAction.bind(null, model.id)}>
					<button className="quiet-button" disabled={!model.enabled} type="submit">
						Selecionar
					</button>
				</form>
			)}
			<form action={setModelEnabledAction.bind(null, model.id, !model.enabled)}>
				<button className="quiet-button" disabled={model.selected} type="submit">
					{model.enabled ? "Desabilitar" : "Habilitar"}
				</button>
			</form>
		</div>
	);
}

function ModelFields({ model }: { readonly model?: DashboardModel }): ReactNode {
	return (
		<>
			<label>
				Nome de exibição
				<input
					defaultValue={model?.displayName}
					maxLength={100}
					name="displayName"
					required
				/>
			</label>
			<label>
				Identificador da API
				<input
					defaultValue={model?.apiName}
					name="apiName"
					pattern="gemini-[a-z0-9.-]+"
					required
				/>
			</label>
			<div className="price-grid">
				<PriceField
					defaultValue={pricePerMillion(model?.inputNanoUsdPerToken)}
					label="Entrada"
					name="inputUsdPerMillion"
				/>
				<PriceField
					defaultValue={pricePerMillion(model?.cachedInputNanoUsdPerToken)}
					label="Entrada em cache"
					name="cachedInputUsdPerMillion"
				/>
				<PriceField
					defaultValue={pricePerMillion(model?.outputNanoUsdPerToken)}
					label="Saída"
					name="outputUsdPerMillion"
				/>
			</div>
			<label className="checkbox-field">
				<input defaultChecked={model?.enabled ?? true} name="enabled" type="checkbox" />
				Habilitado para seleção
			</label>
		</>
	);
}

function PriceField(properties: {
	readonly defaultValue?: string;
	readonly label: string;
	readonly name: string;
}): ReactNode {
	return (
		<label>
			{properties.label} (USD)
			<input
				defaultValue={properties.defaultValue}
				inputMode="decimal"
				name={properties.name}
				pattern="\d+(\.\d{1,3})?"
				placeholder="0.000"
				required
			/>
		</label>
	);
}

function ModelPrices({ model }: { readonly model: DashboardModel }): ReactNode {
	return (
		<dl className="model-prices">
			<div>
				<dt>Entrada</dt>
				<dd>US$ {pricePerMillion(model.inputNanoUsdPerToken)}</dd>
			</div>
			<div>
				<dt>Cache</dt>
				<dd>US$ {pricePerMillion(model.cachedInputNanoUsdPerToken)}</dd>
			</div>
			<div>
				<dt>Saída</dt>
				<dd>US$ {pricePerMillion(model.outputNanoUsdPerToken)}</dd>
			</div>
		</dl>
	);
}

function pricePerMillion(nanoUsdPerToken: number | undefined): string | undefined {
	return nanoUsdPerToken === undefined ? undefined : (nanoUsdPerToken / 1_000).toFixed(3);
}
