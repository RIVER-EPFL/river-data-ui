<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { me } from '$auth/me.svelte';
	import { siteNavigator } from '$lib/stores/sites.svelte';
	import NavIcon from '$components/NavIcon.svelte';

	// Quick access to the caller's sites at the top of the sidebar, grouped project → subproject →
	// site. The tree comes grant-scoped from the API. A project's auto-created default subproject
	// (named after the project) is folded away so the common single-subproject case reads as a flat
	// site list; a distinctly named subproject is always shown so its grouping stays visible.

	let { collapsed = false }: { collapsed?: boolean } = $props();

	// Fetch once me is resolved so the request carries a valid token and users without access never
	// trigger it (the store also no-ops in local no-auth mode).
	$effect(() => {
		if (me.status === 'ready') void siteNavigator.ensure();
	});

	const tree = $derived(siteNavigator.tree);
	const hasSites = $derived(tree.some((p) => p.subprojects.some((sp) => sp.sites.length > 0)));

	// Show a subproject's header unless it's the sole default (auto-created, named after its project).
	function showSubprojectHeader(projectName: string, subCount: number, subName: string): boolean {
		return subCount > 1 || subName !== projectName;
	}

	// Exact match only: the layout's prefix-based isActive would also light the generic /sites item.
	function isActiveSite(id: string): boolean {
		return page.url.pathname === `${base}/sites/${id}`;
	}

	const sitesListActive = $derived(page.url.pathname === `${base}/sites`);
</script>

{#if collapsed}
	<a
		href={`${base}/sites`}
		title="Sites"
		class="flex items-center justify-center px-4 py-2 no-underline {sitesListActive
			? 'text-brand-primary bg-brand-primary/5'
			: 'text-brand-text hover:bg-brand-bg'}"
	>
		<NavIcon name="pin" />
	</a>
{:else}
	<a
		href={`${base}/sites`}
		class="flex items-center gap-2 px-4 py-2 text-sm no-underline {sitesListActive
			? 'text-brand-primary bg-brand-primary/5 font-semibold'
			: 'text-brand-text hover:bg-brand-bg'}"
	>
		<NavIcon name="pin" />
		Sites
	</a>
	{#if hasSites}
		<div
			class="flex flex-col max-h-[40vh] shrink-0 mx-2 mt-1 rounded-md border border-dashed border-brand-primary/40 bg-brand-primary/5 pb-2 overflow-hidden"
		>
			<div class="overflow-y-auto min-h-0">
				{#each tree as project (project.project_id)}
					<div
						class="px-4 pt-3 pb-1 text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-brand-muted truncate"
						title={project.name}
					>
						{project.name}
					</div>
					{#each project.subprojects as subproject (subproject.id ?? subproject.name)}
						{@const showHeader = showSubprojectHeader(project.name, project.subprojects.length, subproject.name)}
						{#if showHeader}
							<div
								class="pl-6 pr-4 pt-2 pb-0.5 text-[0.625rem] font-semibold uppercase tracking-[0.08em] text-brand-muted truncate"
								title={subproject.name}
							>
								{subproject.name}
							</div>
						{/if}
						{#each subproject.sites as site (site.id)}
							<a
								href={`${base}/sites/${site.id}`}
								title={site.name}
								class="flex items-center gap-2 {showHeader ? 'pl-8' : 'pl-6'} pr-4 py-1.5 text-sm no-underline transition-colors {isActiveSite(site.id)
									? 'text-brand-primary bg-brand-surface font-semibold'
									: 'text-brand-text hover:bg-brand-primary/15'}"
							>
								<span class="truncate">{site.name}</span>
							</a>
						{/each}
					{/each}
				{/each}
			</div>
		</div>
	{/if}
{/if}
