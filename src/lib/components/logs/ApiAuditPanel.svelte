<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type ApiToken, type ApiTokenAuditLog, type Project } from '$api/crud';
	import { getAuditStatusCodes } from '$api/service';
	import { statusBadgeClass, formatDateTime } from '$lib/utils';
	import TokenDetailDialog from '$components/tokens/TokenDetailDialog.svelte';
	import PaginationControls from '$components/ui/PaginationControls.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	let tokens = $state<ApiToken[]>([]);
	let projects = $state<Project[]>([]);
	const tokenNames = $derived(new Map(tokens.map((t) => [t.id, t.name])));
	const projectNames = $derived(new Map(projects.map((p) => [p.id, p.name])));

	let statusOptions = $state<number[]>([]);

	let fToken = $state(page.url.searchParams.get('token') ?? '');
	let fMethod = $state('');
	let fStatus = $state('');

	const perPage = 50;
	let currentPage = $state(1);
	let total = $state(0);
	let logs = $state<ApiTokenAuditLog[]>([]);
	let loading = $state(true);
	let error = $state('');

	let detailToken = $state<ApiToken | null>(null);
	let detailOpen = $state(false);

	function projectName(id: string | null | undefined): string {
		if (!id) return 'All projects';
		return projectNames.get(id) ?? id.slice(0, 8) + '…';
	}

	function openTokenDetail(log: ApiTokenAuditLog) {
		const t = tokens.find((tk) => tk.id === log.token_id) ?? null;
		detailToken = t;
		detailOpen = true;
	}

	async function load() {
		loading = true;
		error = '';
		try {
			const filter: Record<string, unknown> = {};
			if (fToken) filter.token_id = fToken;
			if (fMethod) filter.method = fMethod;
			if (fStatus) filter.status_code = Number(fStatus);
			const r = await api.apiTokenAuditLogs.list({
				page: currentPage,
				perPage,
				sort: ['created_at', 'DESC'],
				filter,
			});
			logs = r.data;
			total = r.total;
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : 'Failed to load audit log';
			logs = [];
			total = 0;
		} finally {
			loading = false;
		}
	}

	function applyFilters() {
		currentPage = 1;
		load();
	}

	onMount(async () => {
		const [tokRes, projRes, codes] = await Promise.all([
			api.apiTokens.list({ perPage: 200 }).catch(() => ({ data: [], total: 0 })),
			api.projects.list({ perPage: 100 }).catch(() => ({ data: [], total: 0 })),
			getAuditStatusCodes().catch(() => [] as number[]),
		]);
		tokens = tokRes.data;
		projects = projRes.data;
		statusOptions = codes;
		await load();
	});

	function fmt(iso: string): string {
		return formatDateTime(iso);
	}

	function httpStatusBadge(code: number): string {
		if (code >= 500) return 'bg-severity-alarm-soft text-severity-alarm';
		if (code >= 400) return 'bg-severity-warning-soft text-severity-warning';
		return 'bg-severity-ok-soft text-severity-ok';
	}

	const selectCls =
		'px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm text-brand-text';
</script>

<div class="space-y-4">
	<div class="flex flex-wrap items-end gap-3">
		<label class="flex flex-col gap-1 text-xs text-brand-muted">
			Token
			<select bind:value={fToken} onchange={applyFilters} class={selectCls}>
				<option value="">All tokens</option>
				{#each tokens as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">
			Method
			<select bind:value={fMethod} onchange={applyFilters} class={selectCls}>
				<option value="">Any</option>
				<option value="GET">GET</option>
				<option value="POST">POST</option>
				<option value="PUT">PUT</option>
				<option value="PATCH">PATCH</option>
				<option value="DELETE">DELETE</option>
			</select>
		</label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">
			Status
			<select bind:value={fStatus} onchange={applyFilters} class={selectCls}>
				<option value="">Any</option>
				{#each statusOptions as code (code)}<option value={String(code)}>{code}</option>{/each}
			</select>
		</label>
	</div>

	{#if error}
		<ErrorNotice message={error} />
	{/if}

	<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider">
					<th class="text-left px-4 py-2 font-semibold">Time</th>
					<th class="text-left px-4 py-2 font-semibold">Token</th>
					<th class="text-left px-4 py-2 font-semibold">Method</th>
					<th class="text-left px-4 py-2 font-semibold">Path</th>
					<th class="text-left px-4 py-2 font-semibold">Status</th>
					<th class="text-left px-4 py-2 font-semibold">Project</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">Loading…</td></tr>
				{:else if logs.length === 0}
					<tr><td colspan="6" class="px-4 py-8 text-center text-brand-muted">No matching requests.</td></tr>
				{:else}
					{#each logs as l (l.id)}
						<tr class="border-b border-brand-divider last:border-b-0 hover:bg-brand-bg/50 cursor-pointer" onclick={() => openTokenDetail(l)}>
							<td class="whitespace-nowrap px-4 py-2 text-brand-muted">{fmt(l.created_at)}</td>
							<td class="px-4 py-2">
								{#if tokenNames.has(l.token_id)}
									<a href="{base}/tokens?show={l.token_id}" class="text-brand-primary no-underline hover:underline" onclick={(e) => e.stopPropagation()}>{tokenNames.get(l.token_id)}</a>
								{:else}
									<span class="font-mono text-xs text-brand-muted">{l.token_id.slice(0, 8)}…</span>
								{/if}
							</td>
							<td class="px-4 py-2 font-mono">{l.method}</td>
							<td class="px-4 py-2 font-mono break-all">{l.path}</td>
							<td class="px-4 py-2">
								<span class="px-2 py-0.5 text-xs font-medium rounded-full {httpStatusBadge(l.status_code)}">{l.status_code}</span>
							</td>
							<td class="px-4 py-2">
								{#if l.project_scope && projectNames.has(l.project_scope)}
									<a href="{base}/projects/{l.project_scope}" class="text-brand-primary no-underline hover:underline" onclick={(e) => e.stopPropagation()}>{projectNames.get(l.project_scope)}</a>
								{:else if l.project_scope}
									<span class="font-mono text-xs text-brand-muted">{l.project_scope.slice(0, 8)}…</span>
								{:else}
									<span class="text-brand-muted">all</span>
								{/if}
							</td>
						</tr>
					{/each}
				{/if}
			</tbody>
		</table>
	</div>

	<PaginationControls
		{total}
		page={currentPage}
		{perPage}
		onPageChange={(p) => { currentPage = p; load(); }}
	/>
</div>

<TokenDetailDialog bind:open={detailOpen} token={detailToken} {projectName} />
