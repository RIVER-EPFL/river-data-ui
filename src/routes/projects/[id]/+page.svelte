<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type Project, type Site, type PublicExposedParameter, type Parameter } from '$api/crud';
	import { invalidatePublicConfig } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Tabs from '$components/ui/Tabs.svelte';

	let project = $state<Project | null>(null);
	let sites = $state<Site[]>([]);
	let exposedParams = $state<PublicExposedParameter[]>([]);
	let allParameters = $state<Parameter[]>([]);
	let loading = $state(true);
	let activeTab = $state(0);
	let showAddForm = $state(false);
	let showAdvanced = $state(false);

	let editingSlugs = $state<Record<string, string>>({});
	let savingSiteId = $state<string | null>(null);

	let newParam = $state({
		parameter_id: '',
		public_name: '',
		public_units: '',
		description: '',
		sort_order: 0,
		conversion_factor: 1.0,
		conversion_offset: 0.0,
		include_derived: false,
	});

	const projectId = page.params.id!;

	onMount(async () => {
		try {
			const [p, s] = await Promise.all([
				api.projects.get(projectId),
				api.sites.list({ perPage: 100, filter: { project_id: projectId } }),
			]);
			project = p;
			sites = s.data;
		} finally {
			loading = false;
		}
	});

	async function loadExposedParams() {
		const siteParamRequests = sites.map((s) =>
			api.siteParameters.list({ perPage: 200, filter: { site_id: s.id } })
		);
		const [ep, params, ...spResults] = await Promise.all([
			api.publicExposedParameters.list({ perPage: 100, filter: { project_id: projectId }, sort: ['sort_order', 'ASC'] }),
			api.parameters.list({ perPage: 500, sort: ['name', 'ASC'] }),
			...siteParamRequests,
		]);
		exposedParams = ep.data;

		const projectParamIds = new Set(spResults.flatMap((r) => r.data.map((sp) => sp.parameter_id)));
		allParameters = params.data.filter((p) => projectParamIds.has(p.id));
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

	async function addExposedParam() {
		try {
			await api.publicExposedParameters.create({
				project_id: projectId,
				...newParam,
			});
			toastStore.success('Parameter added');
			showAddForm = false;
			newParam = { parameter_id: '', public_name: '', public_units: '', description: '', sort_order: 0, conversion_factor: 1.0, conversion_offset: 0.0, include_derived: false };
			await loadExposedParams();
		} catch {
			toastStore.error('Failed to add parameter');
		}
	}

	async function removeExposedParam(id: string) {
		try {
			await api.publicExposedParameters.remove(id);
			toastStore.success('Parameter removed');
			await loadExposedParams();
		} catch {
			toastStore.error('Failed to remove parameter');
		}
	}

	function paramNameById(id: string): string {
		return allParameters.find((p) => p.id === id)?.display_name ?? id.slice(0, 8);
	}

	async function toggleSitePublic(site: Site) {
		savingSiteId = site.id;
		try {
			const newSlug = site.public_slug ? null : site.name.toLowerCase().replace(/\s+/g, '_');
			await api.sites.update(site.id, { public_slug: newSlug });
			site.public_slug = newSlug;
			sites = [...sites];
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

	$effect(() => {
		if (activeTab === 1 && exposedParams.length === 0 && !loading) {
			loadExposedParams();
		}
	});
</script>

<svelte:head><title>{project?.name ?? 'Project'} | River Data</title></svelte:head>

{#if loading}
	<p class="text-brand-muted">Loading...</p>
{:else if project}
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<div>
				<a href="{base}/projects" class="text-sm text-brand-muted hover:text-brand-primary no-underline">&larr; Projects</a>
				<h2 class="text-xl font-semibold mt-1">{project.name}</h2>
			</div>
			<a href="{base}/projects/{project.id}/edit" class="px-3 py-1.5 border border-brand-divider bg-brand-surface text-sm rounded-md no-underline text-brand-text hover:bg-brand-bg">Edit</a>
		</div>

		<Tabs tabs={['Overview', 'Public API']} bind:active={activeTab} />

		{#if activeTab === 0}
			<div class="space-y-4">
				<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3 max-w-xl">
					<div><span class="text-sm text-brand-muted">Description</span><p class="text-sm">{project.description ?? '---'}</p></div>
					<div><span class="text-sm text-brand-muted">Created</span><p class="text-sm">{new Date(project.created_at).toLocaleString()}</p></div>
				</div>

				<!-- Sites -->
				<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
					<div class="px-4 py-3 bg-brand-bg border-b border-brand-divider">
						<span class="text-sm font-semibold">Sites</span>
					</div>
					<table class="w-full text-sm">
						<thead><tr class="bg-brand-bg border-b border-brand-divider">
							<th class="text-left px-4 py-2 font-semibold">Name</th>
							<th class="text-left px-4 py-2 font-semibold">Coordinates</th>
							<th class="text-left px-4 py-2 font-semibold">Public Slug</th>
							<th class="text-center px-4 py-2 font-semibold">Public</th>
						</tr></thead>
						<tbody>
							{#each sites as site}
								<tr class="border-b border-brand-divider last:border-b-0">
									<td class="px-4 py-2"><a href="{base}/sites/{site.id}" class="text-brand-primary no-underline hover:underline">{site.name}</a></td>
									<td class="px-4 py-2 text-brand-muted font-mono text-xs">
										{#if site.latitude && site.longitude}
											{site.latitude.toFixed(4)}, {site.longitude.toFixed(4)}
										{:else}
											---
										{/if}
									</td>
									<td class="px-4 py-2">
										{#if site.id in editingSlugs}
											<div class="flex items-center gap-1">
												<input
													bind:value={editingSlugs[site.id]}
													class="px-2 py-1 text-sm font-mono border border-brand-divider rounded bg-brand-surface w-36"
													onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') saveSiteSlug(site); if (e.key === 'Escape') cancelEditingSlug(site.id); }}
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
									<td class="px-4 py-2 text-center">
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
								</tr>
							{/each}
							{#if sites.length === 0}
								<tr><td colspan="4" class="px-4 py-6 text-center text-brand-muted">No sites</td></tr>
							{/if}
						</tbody>
					</table>
				</div>
			</div>
		{:else if activeTab === 1}
			<div class="space-y-4">
				<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-3 max-w-xl">
					<div class="flex items-center gap-2">
						<span class="text-sm font-medium">Public API</span>
						{#if project.is_public}
							<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-severity-ok-soft text-severity-ok">Enabled</span>
						{:else}
							<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-brand-bg text-brand-muted">Disabled</span>
						{/if}
					</div>
					{#if project.public_slug}
						<div>
							<span class="text-sm text-brand-muted">Slug</span>
							<p class="text-sm font-mono">{project.public_slug}</p>
						</div>
						<div>
							<span class="text-sm text-brand-muted">Public URL</span>
							<p class="text-sm font-mono">/api/public/{project.public_slug}</p>
						</div>
						{#if project.public_api_title}
							<div>
								<span class="text-sm text-brand-muted">API Title</span>
								<p class="text-sm">{project.public_api_title}</p>
							</div>
						{/if}
						{#if project.public_api_version}
							<div>
								<span class="text-sm text-brand-muted">API Version</span>
								<p class="text-sm font-mono">{project.public_api_version}</p>
							</div>
						{/if}
						{#if project.public_contact_email}
							<div>
								<span class="text-sm text-brand-muted">Contact</span>
								<p class="text-sm">{project.public_contact_email}</p>
							</div>
						{/if}
						<div class="flex gap-2 pt-2">
							<a href="/api/public/{project.public_slug}/docs" target="_blank" class="px-3 py-1.5 text-sm bg-brand-primary text-white rounded-md no-underline hover:bg-brand-primary-dark">View API Docs</a>
							<button onclick={handleInvalidateCache} class="px-3 py-1.5 text-sm border border-brand-divider rounded-md bg-brand-surface cursor-pointer hover:bg-brand-bg">Invalidate Cache</button>
						</div>
					{/if}
				</div>

				<!-- Public Sites Summary -->
				<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
					<div class="px-4 py-3 bg-brand-bg border-b border-brand-divider">
						<span class="text-sm font-semibold">Public Sites</span>
						<span class="text-xs text-brand-muted ml-2">Manage in Overview tab</span>
					</div>
					<table class="w-full text-sm">
						<thead><tr class="bg-brand-bg border-b border-brand-divider">
							<th class="text-left px-4 py-2 font-semibold">Site</th>
							<th class="text-left px-4 py-2 font-semibold">Slug</th>
							<th class="text-center px-4 py-2 font-semibold">Status</th>
						</tr></thead>
						<tbody>
							{#each sites as site}
								<tr class="border-b border-brand-divider last:border-b-0">
									<td class="px-4 py-2">{site.name}</td>
									<td class="px-4 py-2 font-mono text-xs">{site.public_slug ?? '---'}</td>
									<td class="px-4 py-2 text-center">
										{#if site.public_slug}
											<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-severity-ok-soft text-severity-ok">On</span>
										{:else}
											<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-brand-bg text-brand-muted">Off</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<!-- Exposed Parameters -->
				<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
					<div class="flex items-center justify-between px-4 py-3 bg-brand-bg border-b border-brand-divider">
						<span class="text-sm font-semibold">Exposed Parameters</span>
						<button
							onclick={() => showAddForm = !showAddForm}
							class="px-2 py-1 text-xs border border-brand-divider rounded bg-brand-surface cursor-pointer hover:bg-brand-bg"
						>
							{showAddForm ? 'Cancel' : 'Add'}
						</button>
					</div>

					{#if showAddForm}
						<div class="p-4 border-b border-brand-divider bg-brand-bg/50 space-y-3">
							<div class="grid grid-cols-2 gap-3">
								<div>
									<label for="ep-param" class="text-xs text-brand-muted block mb-1">Parameter</label>
									<select id="ep-param" bind:value={newParam.parameter_id} class="w-full px-2 py-1.5 text-sm border border-brand-divider rounded bg-brand-surface">
										<option value="">Select...</option>
										{#each allParameters as p}
											<option value={p.id}>{p.display_name} ({p.name})</option>
										{/each}
									</select>
								</div>
								<div>
									<label for="ep-name" class="text-xs text-brand-muted block mb-1">Public Name</label>
									<input id="ep-name" bind:value={newParam.public_name} placeholder="e.g. DOuM" class="w-full px-2 py-1.5 text-sm border border-brand-divider rounded bg-brand-surface" />
								</div>
								<div>
									<label for="ep-units" class="text-xs text-brand-muted block mb-1">Public Units</label>
									<input id="ep-units" bind:value={newParam.public_units} placeholder="e.g. uM" class="w-full px-2 py-1.5 text-sm border border-brand-divider rounded bg-brand-surface" />
								</div>
								<div>
									<label for="ep-sort" class="text-xs text-brand-muted block mb-1">Sort Order</label>
									<input id="ep-sort" type="number" bind:value={newParam.sort_order} class="w-full px-2 py-1.5 text-sm border border-brand-divider rounded bg-brand-surface" />
								</div>
							</div>
							<div>
								<label for="ep-desc" class="text-xs text-brand-muted block mb-1">Description</label>
								<input id="ep-desc" bind:value={newParam.description} placeholder="Optional" class="w-full px-2 py-1.5 text-sm border border-brand-divider rounded bg-brand-surface" />
							</div>
							<div class="flex items-center gap-2">
								<input id="ep-derived" type="checkbox" bind:checked={newParam.include_derived} />
								<label for="ep-derived" class="text-xs text-brand-muted">Include derived parameters</label>
							</div>
							<button type="button" onclick={() => showAdvanced = !showAdvanced} class="text-xs text-brand-muted bg-transparent border-none cursor-pointer hover:text-brand-primary">
								{showAdvanced ? 'Hide' : 'Show'} advanced options
							</button>
							{#if showAdvanced}
								<div class="grid grid-cols-2 gap-3 pt-1">
									<div>
										<label for="ep-factor" class="text-xs text-brand-muted block mb-1">Conversion Factor</label>
										<input id="ep-factor" type="number" step="any" bind:value={newParam.conversion_factor} class="w-full px-2 py-1.5 text-sm border border-brand-divider rounded bg-brand-surface" />
									</div>
									<div>
										<label for="ep-offset" class="text-xs text-brand-muted block mb-1">Conversion Offset</label>
										<input id="ep-offset" type="number" step="any" bind:value={newParam.conversion_offset} class="w-full px-2 py-1.5 text-sm border border-brand-divider rounded bg-brand-surface" />
									</div>
								</div>
							{/if}
							<button
								onclick={addExposedParam}
								disabled={!newParam.parameter_id || !newParam.public_name || !newParam.public_units}
								class="px-3 py-1.5 text-sm bg-brand-primary text-white rounded cursor-pointer hover:bg-brand-primary-dark disabled:opacity-50 disabled:cursor-not-allowed"
							>
								Add Parameter
							</button>
						</div>
					{/if}

					<table class="w-full text-sm">
						<thead>
							<tr class="bg-brand-bg border-b border-brand-divider">
								<th class="text-left px-4 py-2 font-semibold">Public Name</th>
								<th class="text-left px-4 py-2 font-semibold">Source Parameter</th>
								<th class="text-left px-4 py-2 font-semibold">Units</th>
								<th class="text-left px-4 py-2 font-semibold">Conversion</th>
								<th class="text-left px-4 py-2 font-semibold">Order</th>
								<th class="px-4 py-2"></th>
							</tr>
						</thead>
						<tbody>
							{#each exposedParams as ep}
								<tr class="border-b border-brand-divider last:border-b-0">
									<td class="px-4 py-2 font-medium">{ep.public_name}</td>
									<td class="px-4 py-2 text-brand-muted">{paramNameById(ep.parameter_id)}</td>
									<td class="px-4 py-2 font-mono text-xs">{ep.public_units}</td>
									<td class="px-4 py-2 font-mono text-xs">
										{#if (ep.conversion_factor ?? 1) !== 1 || (ep.conversion_offset ?? 0) !== 0}
											x{ep.conversion_factor ?? 1}{(ep.conversion_offset ?? 0) !== 0 ? ` + ${ep.conversion_offset}` : ''}
										{:else}
											<span class="text-brand-muted">identity</span>
										{/if}
									</td>
									<td class="px-4 py-2 text-brand-muted">{ep.sort_order}</td>
									<td class="px-4 py-2 text-right">
										<button
											onclick={() => removeExposedParam(ep.id)}
											class="text-xs text-severity-alarm cursor-pointer hover:underline"
										>Remove</button>
									</td>
								</tr>
							{/each}
							{#if exposedParams.length === 0}
								<tr><td colspan="6" class="px-4 py-6 text-center text-brand-muted">No exposed parameters</td></tr>
							{/if}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	</div>
{/if}
