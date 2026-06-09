<script lang="ts">
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import { api, type ApiToken, type ApiTokenAuditLog, type Project } from '$api/crud';
	import { getAuditStatusCodes } from '$api/service';

	// Lookups so the table shows names + links instead of raw UUIDs.
	let tokens = $state<ApiToken[]>([]);
	let projects = $state<Project[]>([]);
	const tokenNames = $derived(new Map(tokens.map((t) => [t.id, t.name])));
	const projectNames = $derived(new Map(projects.map((p) => [p.id, p.name])));

	let statusOptions = $state<number[]>([]);

	// Filters (token seeded from ?token deep-link sent by the token detail dialog).
	let fToken = $state(page.url.searchParams.get('token') ?? '');
	let fMethod = $state('');
	let fStatus = $state('');

	const perPage = 50;
	let currentPage = $state(1);
	let total = $state(0);
	let logs = $state<ApiTokenAuditLog[]>([]);
	let loading = $state(true);
	let error = $state('');

	const totalPages = $derived(Math.max(1, Math.ceil(total / perPage)));

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
		return new Date(iso).toLocaleString();
	}
	const selectCls =
		'px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm text-brand-text';
	const pageBtn =
		'px-2 py-1 border border-brand-divider rounded-md text-sm hover:bg-brand-bg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer';
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
		<div class="rounded-md border border-severity-alarm-border bg-severity-alarm-soft p-3 text-sm text-severity-alarm">
			{error}
		</div>
	{/if}

	<div class="overflow-x-auto rounded-md border border-brand-divider">
		<table class="w-full text-sm">
			<thead class="bg-brand-bg text-left text-xs uppercase tracking-wide text-brand-muted">
				<tr>
					<th class="px-3 py-2">Time</th>
					<th class="px-3 py-2">Token</th>
					<th class="px-3 py-2">Method</th>
					<th class="px-3 py-2">Path</th>
					<th class="px-3 py-2">Status</th>
					<th class="px-3 py-2">Project</th>
				</tr>
			</thead>
			<tbody>
				{#if loading}
					<tr><td colspan="6" class="px-3 py-6 text-center text-brand-muted">Loading…</td></tr>
				{:else if logs.length === 0}
					<tr><td colspan="6" class="px-3 py-6 text-center text-brand-muted">No matching requests.</td></tr>
				{:else}
					{#each logs as l (l.id)}
						<tr class="border-t border-brand-divider">
							<td class="whitespace-nowrap px-3 py-2 text-brand-muted">{fmt(l.created_at)}</td>
							<td class="px-3 py-2">
								{#if tokenNames.has(l.token_id)}
									<a href="{base}/tokens?show={l.token_id}" class="text-brand-primary no-underline hover:underline">{tokenNames.get(l.token_id)}</a>
								{:else}
									<span class="font-mono text-xs text-brand-muted">{l.token_id.slice(0, 8)}…</span>
								{/if}
							</td>
							<td class="px-3 py-2 font-mono">{l.method}</td>
							<td class="px-3 py-2 font-mono break-all">{l.path}</td>
							<td class="px-3 py-2 {l.status_code >= 400 ? 'text-severity-alarm' : 'text-severity-ok'}">{l.status_code}</td>
							<td class="px-3 py-2">
								{#if l.project_scope && projectNames.has(l.project_scope)}
									<a href="{base}/projects/{l.project_scope}" class="text-brand-primary no-underline hover:underline">{projectNames.get(l.project_scope)}</a>
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

	{#if total > perPage}
		<div class="flex items-center justify-between text-sm text-brand-muted">
			<span>{total} total</span>
			<div class="flex items-center gap-2">
				<button class={pageBtn} disabled={currentPage <= 1} onclick={() => { currentPage = Math.max(1, currentPage - 1); load(); }}>Prev</button>
				<span>{currentPage} / {totalPages}</span>
				<button class={pageBtn} disabled={currentPage >= totalPages} onclick={() => { currentPage = Math.min(totalPages, currentPage + 1); load(); }}>Next</button>
			</div>
		</div>
	{/if}
</div>
