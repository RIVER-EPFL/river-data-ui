<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type ApiToken } from '$api/crud';
	import CrudList from '$components/crud/CrudList.svelte';

	// Resolve token_id → name for readability (and to drive the token filter dropdown).
	let tokens = $state<ApiToken[]>([]);
	const tokenNames = $derived(new Map(tokens.map((t) => [t.id, t.name])));
	onMount(async () => {
		try {
			tokens = (await api.apiTokens.list({ perPage: 200 })).data;
		} catch {
			tokens = [];
		}
	});

	function tokenLabel(id: unknown): string {
		const s = String(id);
		return tokenNames.get(s) ?? `${s.slice(0, 8)}…`;
	}

	// API-audit filters → rebuilt into the CrudList `filters` prop; a {#key} remounts the list on change.
	let fToken = $state('');
	let fMethod = $state('');
	let fStatus = $state('');
	const auditFilters = $derived({
		...(fToken ? { token_id: fToken } : {}),
		...(fMethod ? { method: fMethod } : {}),
		...(fStatus ? { status_code: Number(fStatus) } : {}),
	});
	const auditKey = $derived(JSON.stringify(auditFilters));

	const auditColumns = [
		{ key: 'created_at', label: 'Time', sortable: true },
		{ key: 'token_id', label: 'Token', sortable: false, render: (v: unknown) => tokenLabel(v) },
		{ key: 'method', label: 'Method', sortable: true },
		{ key: 'path', label: 'Path', sortable: false },
		{ key: 'status_code', label: 'Status', sortable: true },
		{
			key: 'project_scope',
			label: 'Project',
			sortable: false,
			render: (v: unknown) => (v ? `${String(v).slice(0, 8)}…` : 'all'),
		},
	];
</script>

<div class="space-y-4">
	<div class="flex flex-wrap gap-3 items-end">
		<label class="flex flex-col gap-1 text-xs text-brand-muted">
			Token
			<select bind:value={fToken} class="px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm text-brand-text">
				<option value="">All tokens</option>
				{#each tokens as t}<option value={t.id}>{t.name}</option>{/each}
			</select>
		</label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">
			Method
			<select bind:value={fMethod} class="px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm text-brand-text">
				<option value="">Any</option>
				<option value="GET">GET</option>
				<option value="POST">POST</option>
				<option value="PATCH">PATCH</option>
				<option value="DELETE">DELETE</option>
			</select>
		</label>
		<label class="flex flex-col gap-1 text-xs text-brand-muted">
			Status
			<input type="number" bind:value={fStatus} placeholder="any" class="w-24 px-2 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm" />
		</label>
	</div>

	{#key auditKey}
		<CrudList
			client={api.apiTokenAuditLogs}
			columns={auditColumns}
			title="API token use"
			perPage={50}
			defaultSort={['created_at', 'DESC']}
			filters={auditFilters}
		/>
	{/key}
</div>
