<script lang="ts">
	import { base } from '$app/paths';
	import { api, type ApiToken, type ApiTokenAuditLog, type TokenPermissions } from '$api/crud';
	import Dialog from '$components/ui/Dialog.svelte';
	import TokenAccessSummary from './TokenAccessSummary.svelte';
	import TokenUsagePanel from './TokenUsagePanel.svelte';

	let {
		open = $bindable(false),
		token,
		projectName,
	}: {
		open?: boolean;
		token: ApiToken | null;
		projectName: (id: string | null | undefined) => string;
	} = $props();

	let logs = $state<ApiTokenAuditLog[]>([]);
	let logsLoading = $state(false);
	let logsError = $state('');

	// Pull this key's recent requests from the same audit log the global /logs view reads, so the
	// activity sits next to the key instead of in a detached page.
	$effect(() => {
		if (!open || !token) return;
		const id = token.id;
		logsLoading = true;
		logsError = '';
		logs = [];
		api.apiTokenAuditLogs
			.list({ filter: { token_id: id }, sort: ['created_at', 'DESC'], perPage: 50 })
			.then((r) => (logs = r.data))
			.catch((e) => (logsError = e instanceof Error ? e.message : 'Failed to load activity'))
			.finally(() => (logsLoading = false));
	});

	function fmt(iso: string | null | undefined): string {
		return iso ? new Date(iso).toLocaleString() : '—';
	}
	function statusLabel(t: ApiToken): { text: string; class: string } {
		if (t.is_active === false) return { text: 'Revoked', class: 'text-severity-alarm' };
		if (t.expires_at && new Date(t.expires_at).getTime() <= Date.now())
			return { text: 'Expired', class: 'text-severity-warning' };
		return { text: 'Active', class: 'text-severity-ok' };
	}
	function permList(perms: TokenPermissions | undefined): string {
		if (!perms) return 'none';
		const keys = Object.entries(perms)
			.filter(([, v]) => v)
			.map(([k]) => k.replace(/_/g, ' '));
		return keys.length ? keys.join(', ') : 'none';
	}
</script>

<Dialog bind:open title="Token details" maxWidth="lg">
	{#snippet children()}
		{#if token}
			<div class="space-y-5">
				<div>
					<div class="text-base font-semibold">{token.name}</div>
					{#if token.token_prefix}
						<div class="font-mono text-xs text-brand-muted">rvd_{token.token_prefix}…</div>
					{/if}
				</div>

				<dl class="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
					<div>
						<dt class="text-xs uppercase tracking-wide text-brand-muted">Status</dt>
						<dd class={statusLabel(token).class}>{statusLabel(token).text}</dd>
					</div>
					<div>
						<dt class="text-xs uppercase tracking-wide text-brand-muted">Scope</dt>
						<dd>{projectName(token.project_scope)}</dd>
					</div>
					<div>
						<dt class="text-xs uppercase tracking-wide text-brand-muted">Rate limit</dt>
						<dd>{token.rate_limit_per_second ? `${token.rate_limit_per_second}/s` : 'unlimited'}</dd>
					</div>
					<div class="col-span-2 sm:col-span-3">
						<dt class="text-xs uppercase tracking-wide text-brand-muted">Permissions</dt>
						<dd>{permList(token.permissions)}</dd>
					</div>
					<div>
						<dt class="text-xs uppercase tracking-wide text-brand-muted">Created</dt>
						<dd>{fmt(token.created_at)}</dd>
					</div>
					<div>
						<dt class="text-xs uppercase tracking-wide text-brand-muted">Last used</dt>
						<dd>{fmt(token.last_used_at)}</dd>
					</div>
					<div>
						<dt class="text-xs uppercase tracking-wide text-brand-muted">Expires</dt>
						<dd class={token.expires_at && new Date(token.expires_at).getTime() <= Date.now()
							? 'text-severity-warning'
							: ''}>{token.expires_at ? fmt(token.expires_at) : 'Never'}</dd>
					</div>
					{#if token.description}
						<div class="col-span-2 sm:col-span-3">
							<dt class="text-xs uppercase tracking-wide text-brand-muted">Description</dt>
							<dd>{token.description}</dd>
						</div>
					{/if}
				</dl>

				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<h4 class="text-sm font-semibold">Recent activity</h4>
						<a
							href="{base}/logs"
							class="text-xs text-brand-primary no-underline hover:underline">View all logs →</a
						>
					</div>
					{#if logsLoading}
						<p class="text-xs text-brand-muted">Loading…</p>
					{:else if logsError}
						<p class="text-xs text-severity-alarm">{logsError}</p>
					{:else if logs.length === 0}
						<p class="text-xs text-brand-muted">No requests recorded for this key yet.</p>
					{:else}
						<div class="max-h-64 overflow-y-auto rounded-md border border-brand-divider">
							<table class="w-full text-xs">
								<thead
									class="sticky top-0 bg-brand-bg text-left uppercase tracking-wide text-brand-muted"
								>
									<tr>
										<th class="px-2 py-1.5">Time</th>
										<th class="px-2 py-1.5">Method</th>
										<th class="px-2 py-1.5">Path</th>
										<th class="px-2 py-1.5">Status</th>
									</tr>
								</thead>
								<tbody>
									{#each logs as l (l.id)}
										<tr class="border-t border-brand-divider">
											<td class="whitespace-nowrap px-2 py-1 text-brand-muted">{fmt(l.created_at)}</td>
											<td class="px-2 py-1 font-mono">{l.method}</td>
											<td class="px-2 py-1 font-mono break-all">{l.path}</td>
											<td
												class="px-2 py-1 {l.status_code >= 400
													? 'text-severity-alarm'
													: 'text-severity-ok'}">{l.status_code}</td
											>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				</div>

				<div class="space-y-2">
					<h4 class="text-sm font-semibold">Use this key</h4>
					<TokenAccessSummary
						permissions={token.permissions}
						projectScope={token.project_scope}
						projectName={projectName(token.project_scope)}
					/>
					<p class="text-xs text-brand-muted">
						Supply your key in place of
						<code class="rounded bg-brand-bg px-1">YOUR_API_TOKEN</code> (shown only once at creation —
						Rotate to issue a new one).
					</p>
					<TokenUsagePanel permissions={token.permissions} projectScope={token.project_scope} />
				</div>
			</div>
		{/if}
	{/snippet}
	{#snippet actions()}
		<button
			onclick={() => (open = false)}
			class="cursor-pointer rounded-md border border-brand-divider bg-brand-surface px-3 py-1.5 text-sm hover:bg-brand-bg"
			>Close</button
		>
	{/snippet}
</Dialog>
