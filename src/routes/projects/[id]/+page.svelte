<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type Project, type Site, type SiteParameter, type Parameter } from '$api/crud';
	import { invalidatePublicConfig } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Markdown from '$lib/components/Markdown.svelte';

	let project = $state<Project | null>(null);
	let sites = $state<Site[]>([]);
	let parameters = $state<Parameter[]>([]);
	let loading = $state(true);

	// Inline editing state
	let editingSlugs = $state<Record<string, string>>({});
	let savingSiteId = $state<string | null>(null);
	let savingField = $state<string | null>(null);

	// Expandable site parameters
	let expandedSiteId = $state<string | null>(null);
	let siteParams = $state<Record<string, SiteParameter[]>>({});
	let loadingSiteParams = $state<string | null>(null);
	let togglingParamId = $state<string | null>(null);

	const projectId = page.params.id!;

	onMount(async () => {
		try {
			const [p, s, params] = await Promise.all([
				api.projects.get(projectId),
				api.sites.list({ perPage: 100, filter: { project_id: projectId } }),
				api.parameters.list({ perPage: 500 }),
			]);
			project = p;
			sites = s.data;
			parameters = params.data;
		} finally {
			loading = false;
		}
	});

	function paramName(parameterId: string): string {
		return parameters.find((p) => p.id === parameterId)?.display_name
			?? parameters.find((p) => p.id === parameterId)?.name
			?? parameterId;
	}

	function paramUnits(sp: SiteParameter): string {
		return sp.display_units ?? parameters.find((p) => p.id === sp.parameter_id)?.default_units ?? '';
	}

	// ── Project-level saves ──────────────────────────────────────────

	async function togglePublicApi() {
		if (!project) return;
		savingField = 'is_public';
		try {
			const newVal = !project.is_public;
			const update: Partial<Project> = { is_public: newVal };
			if (newVal && !project.public_slug) {
				update.public_slug = project.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
			}
			await api.projects.update(project.id, update);
			project = { ...project, ...update };
			toastStore.success(newVal ? 'Public API enabled' : 'Public API disabled');
		} catch {
			toastStore.error('Failed to update project');
		} finally {
			savingField = null;
		}
	}

	async function handleInvalidateCache() {
		if (!project?.public_slug) return;
		try {
			await invalidatePublicConfig(project.public_slug);
			toastStore.success('Public API cache invalidated');
		} catch {
			toastStore.error('Failed to invalidate cache');
		}
	}

	// ── Site-level saves ─────────────────────────────────────────────

	async function toggleSitePublic(site: Site) {
		savingSiteId = site.id;
		try {
			const newSlug = site.public_slug ? null : site.name.toLowerCase().replace(/\s+/g, '_');
			await api.sites.update(site.id, { public_slug: newSlug });
			site.public_slug = newSlug;
			sites = [...sites];
			if (!newSlug && expandedSiteId === site.id) expandedSiteId = null;
			toastStore.success(newSlug ? `${site.name} enabled` : `${site.name} disabled`);
		} catch {
			toastStore.error('Failed to update site');
		} finally {
			savingSiteId = null;
		}
	}

	async function saveSiteSlug(site: Site) {
		savingSiteId = site.id;
		try {
			const slug = editingSlugs[site.id] ?? site.public_slug;
			await api.sites.update(site.id, { public_slug: slug || null });
			site.public_slug = slug || null;
			sites = [...sites];
			delete editingSlugs[site.id];
			editingSlugs = { ...editingSlugs };
			toastStore.success('Slug updated');
		} catch {
			toastStore.error('Failed to update slug');
		} finally {
			savingSiteId = null;
		}
	}

	function startEditingSlug(site: Site) {
		editingSlugs[site.id] = site.public_slug ?? site.name.toLowerCase().replace(/\s+/g, '_');
		editingSlugs = { ...editingSlugs };
	}

	function cancelEditingSlug(siteId: string) {
		delete editingSlugs[siteId];
		editingSlugs = { ...editingSlugs };
	}

	// ── Site parameter expand/toggle ─────────────────────────────────

	async function toggleExpand(site: Site) {
		if (expandedSiteId === site.id) {
			expandedSiteId = null;
			return;
		}
		expandedSiteId = site.id;
		if (!siteParams[site.id]) {
			loadingSiteParams = site.id;
			try {
				const result = await api.siteParameters.list({ perPage: 200, filter: { site_id: site.id } });
				siteParams[site.id] = result.data.filter((sp) => !sp.is_derived);
				siteParams = { ...siteParams };
			} catch {
				toastStore.error('Failed to load parameters');
				expandedSiteId = null;
			} finally {
				loadingSiteParams = null;
			}
		}
	}

	async function toggleParamPublic(sp: SiteParameter) {
		togglingParamId = sp.id;
		try {
			const newVal = !sp.is_public;
			await api.siteParameters.update(sp.id, { is_public: newVal });
			sp.is_public = newVal;
			siteParams = { ...siteParams };
			toastStore.success(newVal ? `${paramName(sp.parameter_id)} now public` : `${paramName(sp.parameter_id)} now private`);
		} catch {
			toastStore.error('Failed to update parameter');
		} finally {
			togglingParamId = null;
		}
	}

	function publicParamCount(siteId: string): { pub: number; total: number } | null {
		const params = siteParams[siteId];
		if (!params) return null;
		return { pub: params.filter((sp) => sp.is_public).length, total: params.length };
	}
</script>

<svelte:head><title>{project?.name ?? 'Project'} | River Data</title></svelte:head>

{#if loading}
	<p class="text-brand-muted">Loading...</p>
{:else if project}
	<div class="space-y-6">
		<!-- Header -->
		<div class="flex items-center justify-between">
			<div>
				<a href="{base}/projects" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Projects</a>
				<h2 class="text-xl font-semibold mt-1">{project.name}</h2>
			</div>
			<a href="{base}/projects/{project.id}/edit" class="px-3 py-1.5 border border-brand-divider bg-brand-surface text-sm rounded-md no-underline text-brand-text hover:bg-brand-bg">Edit</a>
		</div>

		<!-- Project Info -->
		<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-2 max-w-xl">
			<div><span class="text-sm text-brand-muted">Description</span><p class="text-sm">{project.description ?? '---'}</p></div>
			<div><span class="text-sm text-brand-muted">Created</span><p class="text-sm">{new Date(project.created_at).toLocaleString()}</p></div>
		</div>

		<!-- Sites ─────────────────────────────────────────────────── -->
		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<div class="px-4 py-3 bg-brand-bg border-b border-brand-divider">
				<span class="text-sm font-semibold">Sites</span>
			</div>
			<table class="w-full text-sm">
				<thead><tr class="bg-brand-bg border-b border-brand-divider">
					<th class="text-left px-4 py-2 font-semibold w-8"></th>
					<th class="text-left px-4 py-2 font-semibold">Name</th>
					<th class="text-left px-4 py-2 font-semibold">Coordinates</th>
					{#if project.is_public}
						<th class="text-left px-4 py-2 font-semibold">Slug</th>
						<th class="text-center px-4 py-2 font-semibold">Public</th>
						<th class="text-center px-4 py-2 font-semibold">Params</th>
					{/if}
				</tr></thead>
				<tbody>
					{#each sites as site}
						{@const counts = publicParamCount(site.id)}
						<tr
							class="border-b border-brand-divider last:border-b-0 {project.is_public && site.public_slug ? 'cursor-pointer hover:bg-brand-bg/50' : ''}"
							onclick={() => { if (project?.is_public && site.public_slug) toggleExpand(site); }}
						>
							<td class="px-4 py-2 text-brand-muted text-xs w-8">
								{#if project.is_public && site.public_slug}
									<span class="inline-block transition-transform {expandedSiteId === site.id ? 'rotate-90' : ''}">▸</span>
								{/if}
							</td>
							<td class="px-4 py-2">
								<a href="{base}/sites/{site.id}" class="text-brand-primary no-underline hover:underline" onclick={(e) => e.stopPropagation()}>{site.name}</a>
								{#if project.is_public && site.public_slug && project.public_slug}
									<a
										href="/api/public/{project.public_slug}/sites/{site.public_slug}"
										target="_blank"
										class="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-severity-ok-soft text-severity-ok no-underline hover:underline"
										onclick={(e) => e.stopPropagation()}
										title="View in public API"
									>Public ↗</a>
								{/if}
							</td>
							<td class="px-4 py-2 text-brand-muted font-mono text-xs">
								{#if site.latitude && site.longitude}
									{site.latitude.toFixed(4)}, {site.longitude.toFixed(4)}
								{:else}
									---
								{/if}
							</td>
							{#if project.is_public}
								<td class="px-4 py-2" onclick={(e) => e.stopPropagation()}>
									{#if site.id in editingSlugs}
										<div class="flex items-center gap-1">
											<input
												bind:value={editingSlugs[site.id]}
												class="px-2 py-1 text-sm font-mono border border-brand-divider rounded bg-brand-surface w-36"
												onkeydown={(e) => { if (e.key === 'Enter') saveSiteSlug(site); if (e.key === 'Escape') cancelEditingSlug(site.id); }}
												onclick={(e) => e.stopPropagation()}
											/>
											<button onclick={() => saveSiteSlug(site)} disabled={savingSiteId === site.id} class="text-xs text-brand-primary cursor-pointer hover:underline disabled:opacity-50">Save</button>
											<button onclick={() => cancelEditingSlug(site.id)} class="text-xs text-brand-muted cursor-pointer hover:underline">Cancel</button>
										</div>
									{:else if site.public_slug}
										<button onclick={() => startEditingSlug(site)} class="font-mono text-xs text-brand-text cursor-pointer hover:text-brand-primary" title="Click to edit">{site.public_slug}</button>
									{:else}
										<span class="text-xs text-brand-muted">---</span>
									{/if}
								</td>
								<td class="px-4 py-2 text-center" onclick={(e) => e.stopPropagation()}>
									<button
										onclick={() => toggleSitePublic(site)}
										disabled={savingSiteId === site.id}
										class="cursor-pointer disabled:opacity-50"
										title={site.public_slug ? 'Disable public access' : 'Enable public access'}
									>
										{#if site.public_slug}
											<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-severity-ok-soft text-severity-ok">On</span>
										{:else}
											<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-brand-bg text-brand-muted">Off</span>
										{/if}
									</button>
								</td>
								<td class="px-4 py-2 text-center text-xs text-brand-muted">
									{#if site.public_slug && counts}
										<span class="{counts.pub > 0 ? 'text-severity-ok' : ''}">{counts.pub}</span>/{counts.total}
									{:else if site.public_slug}
										<span class="text-brand-muted">...</span>
									{:else}
										—
									{/if}
								</td>
							{/if}
						</tr>

						<!-- Expanded parameter list -->
						{#if expandedSiteId === site.id}
							<tr>
								<td colspan="{project.is_public ? 6 : 3}" class="p-0">
									<div class="bg-brand-bg/30 border-b border-brand-divider">
										{#if loadingSiteParams === site.id}
											<p class="px-8 py-4 text-xs text-brand-muted">Loading parameters...</p>
										{:else if siteParams[site.id]?.length}
											<table class="w-full text-sm">
												<thead><tr class="border-b border-brand-divider">
													<th class="text-left px-8 py-1.5 text-xs font-medium text-brand-muted">Parameter</th>
													<th class="text-left px-4 py-1.5 text-xs font-medium text-brand-muted">Units</th>
													<th class="text-center px-4 py-1.5 text-xs font-medium text-brand-muted">Public</th>
												</tr></thead>
												<tbody>
													{#each siteParams[site.id] as sp}
														<tr class="border-b border-brand-divider last:border-b-0">
															<td class="px-8 py-1.5">{paramName(sp.parameter_id)}</td>
															<td class="px-4 py-1.5 text-brand-muted text-xs">{paramUnits(sp)}</td>
															<td class="px-4 py-1.5 text-center">
																<button
																	onclick={() => toggleParamPublic(sp)}
																	disabled={togglingParamId === sp.id}
																	class="cursor-pointer disabled:opacity-50"
																	title={sp.is_public ? 'Remove from public API' : 'Add to public API'}
																>
																	{#if sp.is_public}
																		<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-severity-ok-soft text-severity-ok">On</span>
																	{:else}
																		<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-brand-bg text-brand-muted">Off</span>
																	{/if}
																</button>
															</td>
														</tr>
													{/each}
												</tbody>
											</table>
										{:else}
											<p class="px-8 py-4 text-xs text-brand-muted">No measurement parameters configured for this site.</p>
										{/if}
									</div>
								</td>
							</tr>
						{/if}
					{/each}
					{#if sites.length === 0}
						<tr><td colspan="{project.is_public ? 6 : 3}" class="px-4 py-6 text-center text-brand-muted">No sites</td></tr>
					{/if}
				</tbody>
			</table>
		</div>

		<!-- Public API ────────────────────────────────────────────── -->
		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<div class="px-4 py-3 bg-brand-bg border-b border-brand-divider flex items-center justify-between">
				<div class="flex items-center gap-3">
					<span class="text-sm font-semibold">Public API</span>
					<button
						onclick={togglePublicApi}
						disabled={savingField === 'is_public'}
						class="cursor-pointer disabled:opacity-50"
						title={project.is_public ? 'Disable public API' : 'Enable public API'}
					>
						{#if project.is_public}
							<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-severity-ok-soft text-severity-ok">Enabled</span>
						{:else}
							<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-brand-bg text-brand-muted border border-brand-divider">Disabled</span>
						{/if}
					</button>
					{#if project.is_public && project.public_slug}
						<a href="/api/public/{project.public_slug}" target="_blank" class="text-xs text-brand-muted font-mono no-underline hover:text-brand-primary hover:underline">/api/public/{project.public_slug}</a>
					{/if}
				</div>
				{#if project.is_public && project.public_slug}
					<div class="flex gap-2">
						<a href="/api/public/{project.public_slug}/docs" target="_blank" class="px-3 py-1.5 text-xs bg-brand-primary text-white rounded-md no-underline hover:bg-brand-primary-dark">API Docs ↗</a>
						<button onclick={handleInvalidateCache} class="px-3 py-1.5 text-xs border border-brand-divider rounded-md bg-brand-surface cursor-pointer hover:bg-brand-bg">Invalidate Cache</button>
					</div>
				{/if}
			</div>

			{#if project.is_public}
				<div class="p-4 space-y-4">
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
						<div>
							<span class="text-xs text-brand-muted">Slug</span>
							<p class="mt-0.5 text-sm font-mono">{project.public_slug ?? '---'}</p>
						</div>
						<div>
							<span class="text-xs text-brand-muted">API Title</span>
							<p class="mt-0.5 text-sm">{project.public_api_title ?? '---'}</p>
						</div>
						<div>
							<span class="text-xs text-brand-muted">Version</span>
							<p class="mt-0.5 text-sm font-mono">{project.public_api_version ?? '---'}</p>
						</div>
						<div>
							<span class="text-xs text-brand-muted">Contact Email</span>
							<p class="mt-0.5 text-sm">{project.public_contact_email ?? '---'}</p>
						</div>
					</div>
					<div class="max-w-2xl">
						<span class="text-xs text-brand-muted">Description (markdown)</span>
						<Markdown class="mt-0.5" source={project.public_api_description} />
					</div>
				</div>
			{:else}
				<div class="px-4 py-6 text-center text-sm text-brand-muted">
					Enable to configure public API access for this project.
				</div>
			{/if}
		</div>
	</div>
{/if}
