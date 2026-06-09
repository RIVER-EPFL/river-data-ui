<script lang="ts">
	import { base } from '$app/paths';
	import { api, type ApiToken, type ApiTokenAuditLog } from '$api/crud';
	import Dialog from '$components/ui/Dialog.svelte';
	import Badge from '$components/ui/Badge.svelte';
	import Tabs from '$components/ui/Tabs.svelte';
	import PermissionChips from './PermissionChips.svelte';
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

	let tab = $state(0);
	let logs = $state<ApiTokenAuditLog[]>([]);
	let logsLoading = $state(false);
	let logsError = $state('');

	// Pull this key's recent requests from the same audit log the global /logs view reads, so the
	// activity sits next to the key instead of in a detached page.
	$effect(() => {
		if (!open || !token) return;
		const id = token.id;
		tab = 0;
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
	function status(t: ApiToken): { text: string; variant: 'ok' | 'accent' | 'alarm' } {
		if (t.is_active === false) return { text: 'Revoked', variant: 'alarm' };
		if (t.expires_at && new Date(t.expires_at).getTime() <= Date.now())
			return { text: 'Expired', variant: 'accent' };
		return { text: 'Active', variant: 'ok' };
	}
</script>

<Dialog bind:open title="Token details" maxWidth="md">
	{#snippet children()}
		{#if token}
			<div class="space-y-4">
				<div class="flex items-start justify-between gap-3">
					<div>
						<div class="text-base font-semibold">{token.name}</div>
						{#if token.token_prefix}
							<div class="font-mono text-xs text-brand-muted">rvd_{token.token_prefix}…</div>
						{/if}
					</div>
					<Badge variant={status(token).variant}>{status(token).text}</Badge>
				</div>

				<dl class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
					<div class="flex gap-2">
						<dt class="w-24 shrink-0 text-brand-muted">Scope</dt>
						<dd>{projectName(token.project_scope)}</dd>
					</div>
					<div class="flex gap-2">
						<dt class="w-24 shrink-0 text-brand-muted">Rate limit</dt>
						<dd>{token.rate_limit_per_second ? `${token.rate_limit_per_second}/s` : 'unlimited'}</dd>
					</div>
					<div class="flex gap-2">
						<dt class="w-24 shrink-0 text-brand-muted">Created</dt>
						<dd>{fmt(token.created_at)}</dd>
					</div>
					<div class="flex gap-2">
						<dt class="w-24 shrink-0 text-brand-muted">Last used</dt>
						<dd>{fmt(token.last_used_at)}</dd>
					</div>
					<div class="flex gap-2">
						<dt class="w-24 shrink-0 text-brand-muted">Expires</dt>
						<dd class={token.expires_at && new Date(token.expires_at).getTime() <= Date.now()
							? 'text-brand-accent-dark'
							: ''}>{token.expires_at ? fmt(token.expires_at) : 'Never'}</dd>
					</div>
					<div class="col-span-2 flex gap-2">
						<dt class="w-24 shrink-0 pt-0.5 text-brand-muted">Permissions</dt>
						<dd><PermissionChips permissions={token.permissions} /></dd>
					</div>
					{#if token.description}
						<div class="col-span-2 flex gap-2">
							<dt class="w-24 shrink-0 text-brand-muted">Description</dt>
							<dd>{token.description}</dd>
						</div>
					{/if}
				</dl>

				<Tabs tabs={['Activity', 'Usage']} bind:active={tab} />

				{#if tab === 0}
					<div class="space-y-2">
						<div class="flex items-center justify-between">
							<h4 class="text-sm font-semibold">Recent activity</h4>
							<a
								href="{base}/logs?tab=audit&token={token.id}"
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
							<div class="max-h-72 overflow-y-auto rounded-md border border-brand-divider">
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
												<td class="whitespace-nowrap px-2 py-1 text-brand-muted">{fmt(l.created_at)}</td
												>
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
				{:else}
					<div class="space-y-2">
						<TokenAccessSummary
							permissions={token.permissions}
							projectScope={token.project_scope}
							projectName={projectName(token.project_scope)}
						/>
						<p class="text-xs text-brand-muted">
							Supply your key in place of
							<code class="rounded bg-brand-bg px-1">YOUR_API_TOKEN</code> (shown only once at creation
							— Rotate to issue a new one).
						</p>
						<TokenUsagePanel permissions={token.permissions} projectScope={token.project_scope} />
					</div>
				{/if}
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
