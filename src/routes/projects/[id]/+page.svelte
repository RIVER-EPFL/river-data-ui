<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type Project, type Site, type SiteParameter, type Parameter, type Subproject } from '$api/crud';
	import { invalidatePublicConfig } from '$api/service';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { siteNavigator } from '$lib/stores/sites.svelte';
	import { formatDateTime } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import Breadcrumbs from '$components/ui/Breadcrumbs.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import Markdown from '$lib/components/Markdown.svelte';

	let project = $state<Project | null>(null);
	let sites = $state<Site[]>([]);
	let parameters = $state<Parameter[]>([]);
	let subprojects = $state<Subproject[]>([]);
	let allProjects = $state<Project[]>([]);
	let loading = $state(true);

	// Inline editing state
	let editingCodes = $state<Record<string, string>>({});
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
			const [p, s, params, subs, projs] = await Promise.all([
				api.projects.get(projectId),
				api.sites.list({ perPage: 100, filter: { project_id: projectId } }),
				api.parameters.list({ perPage: 500 }),
				api.subprojects.list({ perPage: 1000, sort: ['name', 'ASC'], filter: { project_id: projectId } }),
				api.projects.list({ perPage: 100, sort: ['name', 'ASC'] }),
			]);
			project = p;
			sites = s.data;
			parameters = params.data;
			subprojects = subs.data;
			allProjects = projs.data;
		} finally {
			loading = false;
		}
	});

	function paramName(parameterId: string): string {
		return parameters.find((p) => p.id === parameterId)?.name ?? parameterId;
	}

	function paramCode(parameterId: string): string {
		return parameters.find((p) => p.id === parameterId)?.code ?? '';
	}

	function paramUnits(sp: SiteParameter): string {
		return sp.display_units ?? parameters.find((p) => p.id === sp.parameter_id)?.default_units ?? '';
	}

	// ── Subprojects ──────────────────────────────────────────────────

	let newSubName = $state('');
	let newSubDescription = $state('');
	let creatingSub = $state(false);
	let editingSubs = $state<Record<string, { name: string; description: string }>>({});
	let savingSubId = $state<string | null>(null);
	// Destination project selected in a row's move control (only rows with a pending move).
	let pendingMoves = $state<Record<string, string>>({});

	function siteCount(subprojectId: string): number {
		return sites.filter((s) => s.subproject_id === subprojectId).length;
	}

	function sitesInSubproject(subprojectId: string): Site[] {
		return sites.filter((s) => s.subproject_id === subprojectId);
	}

	function subprojectName(id: string | null): string {
		if (!id) return '—';
		return subprojects.find((s) => s.id === id)?.name ?? '—';
	}

	// Interrogate a subproject's sites, and move them between subprojects, without leaving the page.
	let sitesDialogSub = $state<Subproject | null>(null);
	let sitesDialogOpen = $state(false);
	let movingSiteId = $state<string | null>(null);

	function openSitesDialog(sub: Subproject) {
		sitesDialogSub = sub;
		sitesDialogOpen = true;
	}

	async function moveSiteToSubproject(site: Site, destSubprojectId: string) {
		if (!destSubprojectId || destSubprojectId === site.subproject_id) return;
		movingSiteId = site.id;
		try {
			await api.sites.update(site.id, { subproject_id: destSubprojectId });
			site.subproject_id = destSubprojectId;
			sites = [...sites];
			void siteNavigator.refresh();
			toastStore.success(`${site.name} moved to ${subprojectName(destSubprojectId)}`);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to move site');
		} finally {
			movingSiteId = null;
		}
	}

	async function reloadSubprojectsAndSites() {
		const [s, subs] = await Promise.all([
			api.sites.list({ perPage: 100, filter: { project_id: projectId } }),
			api.subprojects.list({ perPage: 1000, sort: ['name', 'ASC'], filter: { project_id: projectId } }),
		]);
		sites = s.data;
		subprojects = subs.data;
		void siteNavigator.refresh();
	}

	async function createSubproject() {
		if (!newSubName.trim()) return;
		creatingSub = true;
		try {
			await api.subprojects.create({
				project_id: projectId,
				name: newSubName.trim(),
				description: newSubDescription.trim() || null,
			});
			newSubName = '';
			newSubDescription = '';
			await reloadSubprojectsAndSites();
			toastStore.success('Subproject created');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to create subproject');
		} finally {
			creatingSub = false;
		}
	}

	function startEditingSub(sub: Subproject) {
		editingSubs[sub.id] = { name: sub.name, description: sub.description ?? '' };
		editingSubs = { ...editingSubs };
	}

	function cancelEditingSub(id: string) {
		delete editingSubs[id];
		editingSubs = { ...editingSubs };
	}

	async function saveSub(sub: Subproject) {
		const edit = editingSubs[sub.id];
		if (!edit || !edit.name.trim()) return;
		savingSubId = sub.id;
		try {
			await api.subprojects.update(sub.id, {
				name: edit.name.trim(),
				description: edit.description.trim() || null,
			});
			cancelEditingSub(sub.id);
			await reloadSubprojectsAndSites();
			toastStore.success('Subproject updated');
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to update subproject');
		} finally {
			savingSubId = null;
		}
	}

	async function moveSub(sub: Subproject) {
		const dest = pendingMoves[sub.id];
		if (!dest || dest === projectId) return;
		savingSubId = sub.id;
		try {
			await api.subprojects.update(sub.id, { project_id: dest });
			delete pendingMoves[sub.id];
			pendingMoves = { ...pendingMoves };
			await reloadSubprojectsAndSites();
			const destName = allProjects.find((p) => p.id === dest)?.name ?? 'the other project';
			toastStore.success(`Subproject moved to ${destName} with its sites`);
		} catch (e) {
			toastStore.error(e instanceof Error ? e.message : 'Failed to move subproject');
		} finally {
			savingSubId = null;
		}
	}

	function cancelMove(id: string) {
		delete pendingMoves[id];
		pendingMoves = { ...pendingMoves };
	}

	async function deleteSub(sub: Subproject) {
		savingSubId = sub.id;
		try {
			await api.subprojects.remove(sub.id);
			await reloadSubprojectsAndSites();
			toastStore.success('Subproject deleted');
		} catch {
			toastStore.error('Failed to delete subproject — move its sites to another subproject first');
		} finally {
			savingSubId = null;
		}
	}

	// ── Project-level saves ──────────────────────────────────────────

	async function togglePublicApi() {
		if (!project) return;
		savingField = 'is_public';
		try {
			const newVal = !project.is_public;
			const update: Partial<Project> = { is_public: newVal };
			if (newVal && !project.public_code) {
				update.public_code = project.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
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
		if (!project?.public_code) return;
		try {
			await invalidatePublicConfig(project.public_code);
			toastStore.success('Public API cache invalidated');
		} catch {
			toastStore.error('Failed to invalidate cache');
		}
	}

	// ── Site-level saves ─────────────────────────────────────────────

	async function toggleSitePublic(site: Site) {
		savingSiteId = site.id;
		try {
			const newCode = site.public_code ? null : site.name.toLowerCase().replace(/\s+/g, '_');
			await api.sites.update(site.id, { public_code: newCode });
			site.public_code = newCode;
			sites = [...sites];
			if (!newCode && expandedSiteId === site.id) expandedSiteId = null;
			toastStore.success(newCode ? `${site.name} enabled` : `${site.name} disabled`);
		} catch {
			toastStore.error('Failed to update site');
		} finally {
			savingSiteId = null;
		}
	}

	async function saveSiteCode(site: Site) {
		savingSiteId = site.id;
		try {
			const code = editingCodes[site.id] ?? site.public_code;
			await api.sites.update(site.id, { public_code: code || null });
			site.public_code = code || null;
			sites = [...sites];
			delete editingCodes[site.id];
			editingCodes = { ...editingCodes };
			toastStore.success('Code updated');
		} catch {
			toastStore.error('Failed to update code');
		} finally {
			savingSiteId = null;
		}
	}

	function startEditingCode(site: Site) {
		editingCodes[site.id] = site.public_code ?? site.name.toLowerCase().replace(/\s+/g, '_');
		editingCodes = { ...editingCodes };
	}

	function cancelEditingCode(siteId: string) {
		delete editingCodes[siteId];
		editingCodes = { ...editingCodes };
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
				siteParams[site.id] = result.data;
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
	<p class="text-brand-muted">Loading…</p>
{:else if project}
	<div class="space-y-6">
		<!-- Header -->
		<div class="flex items-center justify-between">
			<div>
				<Breadcrumbs items={[{ label: 'Projects', href: `${base}/projects` }]} />
				<h2 class="text-xl font-semibold mt-1">{project.name}</h2>
			</div>
			<a href="{base}/projects/{project.id}/edit" class="px-3 py-1.5 border border-brand-divider bg-brand-surface text-sm rounded-md no-underline text-brand-text hover:bg-brand-bg">Edit</a>
		</div>

		<!-- Project Info -->
		<div class="rounded-md border border-brand-divider bg-brand-surface p-4 space-y-2 max-w-xl">
			<div><span class="text-sm text-brand-muted">Description</span><p class="text-sm">{project.description ?? '---'}</p></div>
			<div><span class="text-sm text-brand-muted">Created</span><p class="text-sm">{formatDateTime(project.created_at)}</p></div>
		</div>

		<!-- Subprojects ───────────────────────────────────────────── -->
		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<div class="px-4 py-3 bg-brand-bg border-b border-brand-divider">
				<span class="text-sm font-semibold">Subprojects</span>
			</div>
			<table class="w-full text-sm">
				<thead><tr class="bg-brand-bg border-b border-brand-divider">
					<th class="text-left px-4 py-2 font-semibold">Name</th>
					<th class="text-left px-4 py-2 font-semibold">Description</th>
					<th class="text-left px-4 py-2 font-semibold">Sites</th>
					<th class="text-left px-4 py-2 font-semibold">Move to project</th>
					<th class="px-4 py-2 w-20"></th>
				</tr></thead>
				<tbody>
					{#each subprojects as sub (sub.id)}
						<tr class="border-b border-brand-divider last:border-b-0">
							{#if sub.id in editingSubs}
								<td class="px-4 py-2">
									<input
										bind:value={editingSubs[sub.id].name}
										class="px-2 py-1 text-sm border border-brand-divider rounded bg-brand-surface w-40"
										onkeydown={(e) => { if (e.key === 'Enter') saveSub(sub); if (e.key === 'Escape') cancelEditingSub(sub.id); }}
									/>
								</td>
								<td class="px-4 py-2" colspan="2">
									<div class="flex items-center gap-1">
										<input
											bind:value={editingSubs[sub.id].description}
											placeholder="Description"
											class="px-2 py-1 text-sm border border-brand-divider rounded bg-brand-surface w-full max-w-xs"
											onkeydown={(e) => { if (e.key === 'Enter') saveSub(sub); if (e.key === 'Escape') cancelEditingSub(sub.id); }}
										/>
										<button onclick={() => saveSub(sub)} disabled={savingSubId === sub.id} class="text-xs text-brand-primary cursor-pointer hover:underline disabled:opacity-50">Save</button>
										<button onclick={() => cancelEditingSub(sub.id)} class="text-xs text-brand-muted cursor-pointer hover:underline">Cancel</button>
									</div>
								</td>
							{:else}
								<td class="px-4 py-2">
									<button onclick={() => startEditingSub(sub)} class="cursor-pointer text-brand-text hover:text-brand-primary" title="Click to rename">{sub.name}</button>
								</td>
								<td class="px-4 py-2 text-brand-muted">{sub.description ?? '—'}</td>
								<td class="px-4 py-2">
									<button
										onclick={() => openSitesDialog(sub)}
										class="text-brand-primary cursor-pointer hover:underline"
										title="View and reorganize sites"
									>{siteCount(sub.id)} site{siteCount(sub.id) === 1 ? '' : 's'}</button>
								</td>
							{/if}
							<td class="px-4 py-2">
								<div class="flex items-center gap-1">
									<select
										value={pendingMoves[sub.id] ?? projectId}
										onchange={(e) => {
											const v = (e.currentTarget as HTMLSelectElement).value;
											if (v === projectId) cancelMove(sub.id);
											else { pendingMoves[sub.id] = v; pendingMoves = { ...pendingMoves }; }
										}}
										class="px-2 py-1 text-xs border border-brand-divider rounded bg-brand-surface"
									>
										{#each allProjects as p (p.id)}
											<option value={p.id}>{p.name}</option>
										{/each}
									</select>
									{#if pendingMoves[sub.id]}
										<ConfirmPopover
											message="Move “{sub.name}” and its {siteCount(sub.id)} site{siteCount(sub.id) === 1 ? '' : 's'} to {allProjects.find((p) => p.id === pendingMoves[sub.id])?.name}? Project grants will follow the destination project."
											confirmLabel="Move"
											confirmVariant="primary"
											onconfirm={() => moveSub(sub)}
										>
											<Button size="sm" disabled={savingSubId === sub.id}>{savingSubId === sub.id ? 'Moving…' : 'Move'}</Button>
										</ConfirmPopover>
										<button onclick={() => cancelMove(sub.id)} class="text-xs text-brand-muted cursor-pointer hover:underline">Cancel</button>
									{/if}
								</div>
							</td>
							<td class="px-4 py-2 text-right">
								<ConfirmPopover
									message="Delete subproject “{sub.name}”?"
									confirmLabel="Delete"
									confirmVariant="alarm"
									onconfirm={() => deleteSub(sub)}
								>
									<Button
										size="sm"
										variant="danger"
										disabled={savingSubId === sub.id || siteCount(sub.id) > 0}
										title={siteCount(sub.id) > 0 ? 'Move its sites to another subproject first' : 'Delete subproject'}
									>Delete</Button>
								</ConfirmPopover>
							</td>
						</tr>
					{/each}
					<!-- Inline create row -->
					<tr class="bg-brand-bg/30">
						<td class="px-4 py-2">
							<input
								bind:value={newSubName}
								placeholder="New subproject name"
								class="px-2 py-1 text-sm border border-brand-divider rounded bg-brand-surface w-40"
								onkeydown={(e) => { if (e.key === 'Enter') createSubproject(); }}
							/>
						</td>
						<td class="px-4 py-2" colspan="3">
							<input
								bind:value={newSubDescription}
								placeholder="Description (optional)"
								class="px-2 py-1 text-sm border border-brand-divider rounded bg-brand-surface w-full max-w-xs"
								onkeydown={(e) => { if (e.key === 'Enter') createSubproject(); }}
							/>
						</td>
						<td class="px-4 py-2 text-right">
							<Button size="sm" variant="primary" onclick={createSubproject} disabled={creatingSub || !newSubName.trim()}>
								{creatingSub ? 'Adding…' : 'Add'}
							</Button>
						</td>
					</tr>
				</tbody>
			</table>
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
					<th class="text-left px-4 py-2 font-semibold">Subproject</th>
					<th class="text-left px-4 py-2 font-semibold">Coordinates</th>
					{#if project.is_public}
						<th class="text-left px-4 py-2 font-semibold">Code</th>
						<th class="text-center px-4 py-2 font-semibold">Public</th>
						<th class="text-center px-4 py-2 font-semibold">Params</th>
					{/if}
				</tr></thead>
				<tbody>
					{#each sites as site}
						{@const counts = publicParamCount(site.id)}
						<tr
							class="border-b border-brand-divider last:border-b-0 {project.is_public && site.public_code ? 'cursor-pointer hover:bg-brand-bg/50' : ''}"
							onclick={() => { if (project?.is_public && site.public_code) toggleExpand(site); }}
						>
							<td class="px-4 py-2 text-brand-muted text-xs w-8">
								{#if project.is_public && site.public_code}
									<span class="inline-block transition-transform {expandedSiteId === site.id ? 'rotate-90' : ''}">▸</span>
								{/if}
							</td>
							<td class="px-4 py-2">
								<a href="{base}/sites/{site.id}" class="text-brand-primary no-underline hover:underline" onclick={(e) => e.stopPropagation()}>{site.name}</a>
								{#if project.is_public && site.public_code && project.public_code}
									<a
										href="/api/public/{project.public_code}/sites/{site.public_code}"
										target="_blank"
										class="ml-2 px-2 py-0.5 text-xs font-medium rounded-full bg-severity-ok-soft text-severity-ok no-underline hover:underline"
										onclick={(e) => e.stopPropagation()}
										title="View in public API"
									>Public ↗</a>
								{/if}
							</td>
							<td class="px-4 py-2" onclick={(e) => e.stopPropagation()}>
								{#if subprojects.length > 1}
									<select
										value={site.subproject_id ?? ''}
										disabled={movingSiteId === site.id}
										onchange={(e) => moveSiteToSubproject(site, (e.currentTarget as HTMLSelectElement).value)}
										class="px-2 py-1 text-xs border border-brand-divider rounded bg-brand-surface text-brand-text"
										title="Move site to another subproject"
									>
										{#each subprojects as s (s.id)}
											<option value={s.id}>{s.name}</option>
										{/each}
									</select>
								{:else}
									<span class="text-brand-muted">{subprojectName(site.subproject_id)}</span>
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
									{#if site.id in editingCodes}
										<div class="flex items-center gap-1">
											<input
												bind:value={editingCodes[site.id]}
												class="px-2 py-1 text-sm font-mono border border-brand-divider rounded bg-brand-surface w-36"
												onkeydown={(e) => { if (e.key === 'Enter') saveSiteCode(site); if (e.key === 'Escape') cancelEditingCode(site.id); }}
												onclick={(e) => e.stopPropagation()}
											/>
											<button onclick={() => saveSiteCode(site)} disabled={savingSiteId === site.id} class="text-xs text-brand-primary cursor-pointer hover:underline disabled:opacity-50">Save</button>
											<button onclick={() => cancelEditingCode(site.id)} class="text-xs text-brand-muted cursor-pointer hover:underline">Cancel</button>
										</div>
									{:else if site.public_code}
										<button onclick={() => startEditingCode(site)} class="font-mono text-xs text-brand-text cursor-pointer hover:text-brand-primary" title="Click to edit">{site.public_code}</button>
									{:else}
										<span class="text-xs text-brand-muted">---</span>
									{/if}
								</td>
								<td class="px-4 py-2 text-center" onclick={(e) => e.stopPropagation()}>
									<button
										onclick={() => toggleSitePublic(site)}
										disabled={savingSiteId === site.id}
										class="cursor-pointer disabled:opacity-50"
										title={site.public_code ? 'Disable public access' : 'Enable public access'}
									>
										{#if site.public_code}
											<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-severity-ok-soft text-severity-ok">On</span>
										{:else}
											<span class="px-2 py-0.5 text-xs font-medium rounded-full bg-brand-bg text-brand-muted">Off</span>
										{/if}
									</button>
								</td>
								<td class="px-4 py-2 text-center text-xs text-brand-muted">
									{#if site.public_code && counts}
										<span class="{counts.pub > 0 ? 'text-severity-ok' : ''}">{counts.pub}</span>/{counts.total}
									{:else if site.public_code}
										<span class="text-brand-muted">...</span>
									{:else} - {/if}
								</td>
							{/if}
						</tr>

						<!-- Expanded parameter list -->
						{#if expandedSiteId === site.id}
							<tr>
								<td colspan="{project.is_public ? 7 : 4}" class="p-0">
									<div class="bg-brand-bg/30 border-b border-brand-divider">
										{#if loadingSiteParams === site.id}
											<p class="px-8 py-4 text-xs text-brand-muted">Loading parameters…</p>
										{:else if siteParams[site.id]?.length}
											<table class="w-full text-sm">
												<thead><tr class="border-b border-brand-divider">
													<th class="text-left px-8 py-1.5 text-xs font-medium text-brand-muted">Code</th>
													<th class="text-left px-4 py-1.5 text-xs font-medium text-brand-muted">Name</th>
													<th class="text-left px-4 py-1.5 text-xs font-medium text-brand-muted">Units</th>
													<th class="text-center px-4 py-1.5 text-xs font-medium text-brand-muted">Public</th>
												</tr></thead>
												<tbody>
													{#each siteParams[site.id] as sp}
														<tr class="border-b border-brand-divider last:border-b-0">
															<td class="px-8 py-1.5 font-mono text-xs">{paramCode(sp.parameter_id)}</td>
															<td class="px-4 py-1.5">
																{paramName(sp.parameter_id)}
																{#if sp.is_derived}
																	<span class="ml-1.5 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-brand-accent/15 text-brand-accent align-middle">derived</span>
																{/if}
															</td>
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
						<tr><td colspan="{project.is_public ? 7 : 4}" class="px-4 py-6 text-center text-brand-muted">No sites</td></tr>
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
					{#if project.is_public && project.public_code}
						<a href="/api/public/{project.public_code}" target="_blank" class="text-xs text-brand-muted font-mono no-underline hover:text-brand-primary hover:underline">/api/public/{project.public_code}</a>
					{/if}
				</div>
				{#if project.is_public && project.public_code}
					<div class="flex gap-2">
						<a href="/api/public/{project.public_code}/docs" target="_blank" class="px-3 py-1.5 text-xs bg-brand-primary text-white rounded-md no-underline hover:bg-brand-primary-dark">API Docs ↗</a>
						<Button size="sm" onclick={handleInvalidateCache}>Invalidate Cache</Button>
					</div>
				{/if}
			</div>

			{#if project.is_public}
				<div class="p-4 space-y-4">
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
						<div>
							<span class="text-xs text-brand-muted">Code</span>
							<p class="mt-0.5 text-sm font-mono">{project.public_code ?? '---'}</p>
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

		<!-- Subproject sites: interrogate + reassign in place -->
		<Dialog bind:open={sitesDialogOpen} title={sitesDialogSub ? `Sites in ${sitesDialogSub.name}` : 'Sites'} maxWidth="md">
			{#snippet children()}
				{#if sitesDialogSub}
					{@const rows = sitesInSubproject(sitesDialogSub.id)}
					{#if rows.length === 0}
						<p class="text-sm text-brand-muted">No sites in this subproject.</p>
					{:else}
						<div class="space-y-1">
							{#each rows as site (site.id)}
								<div class="flex items-center justify-between gap-3 px-3 py-2 rounded-md border border-brand-divider">
									<a href="{base}/sites/{site.id}" class="text-brand-primary no-underline hover:underline text-sm font-medium">{site.name}</a>
									<label class="flex items-center gap-2 text-xs text-brand-muted whitespace-nowrap">
										Move to
										<select
											value={site.subproject_id ?? ''}
											disabled={movingSiteId === site.id || subprojects.length <= 1}
											onchange={(e) => moveSiteToSubproject(site, (e.currentTarget as HTMLSelectElement).value)}
											class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm text-brand-text"
										>
											{#each subprojects as s (s.id)}
												<option value={s.id}>{s.name}</option>
											{/each}
										</select>
									</label>
								</div>
							{/each}
						</div>
					{/if}
					{#if subprojects.length <= 1}
						<p class="mt-3 text-xs text-brand-muted">Create another subproject to move sites between them.</p>
					{/if}
				{/if}
			{/snippet}
			{#snippet actions()}
				<Button onclick={() => (sitesDialogOpen = false)}>Close</Button>
			{/snippet}
		</Dialog>
	</div>
{/if}
