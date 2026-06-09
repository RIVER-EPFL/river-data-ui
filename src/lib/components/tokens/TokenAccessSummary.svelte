<script lang="ts">
	import type { TokenPermissions } from '$api/crud';

	let {
		permissions,
		projectScope = null,
		projectName = null,
	}: {
		permissions: TokenPermissions;
		projectScope?: string | null;
		projectName?: string | null;
	} = $props();

	type Line = { label: string; detail: string; kind: 'read' | 'write' };

	const lines = $derived.by(() => {
		const out: Line[] = [];
		if (permissions.read_metadata)
			out.push({
				label: 'Read metadata',
				detail: 'list & view projects, sites, parameters, sensors, streams, deployments',
				kind: 'read',
			});
		if (permissions.read_data)
			out.push({
				label: 'Read data',
				detail: 'download readings, aggregates, alarms, status events, annotations, samples',
				kind: 'read',
			});
		if (permissions.write_metadata)
			out.push({
				label: 'Write metadata',
				detail: 'create & edit entities (sites, parameters, sensors, thresholds, …)',
				kind: 'write',
			});
		if (permissions.write_data)
			out.push({
				label: 'Write data',
				detail: 'push readings & grab samples, ingest status events, flag / unflag',
				kind: 'write',
			});
		return out;
	});

	const hasWrite = $derived(permissions.write_metadata || permissions.write_data);
	const scopeLabel = $derived(
		projectScope
			? `Scoped to ${projectName ?? projectScope.slice(0, 8) + '…'} — cannot see or touch any other project`
			: 'All projects (unscoped)'
	);
</script>

<div class="border border-brand-divider rounded-md bg-brand-bg p-3 space-y-2 text-sm">
	<div class="font-medium">This key can access:</div>

	<div class="flex items-start gap-2">
		<span class="text-brand-muted text-xs uppercase tracking-wide pt-0.5 w-14 shrink-0">Scope</span>
		<span>{scopeLabel}</span>
	</div>

	{#if lines.length === 0}
		<div class="text-severity-warning">No capabilities granted — this key cannot read or write anything.</div>
	{:else}
		<ul class="space-y-1">
			{#each lines as line}
				<li class="flex items-start gap-2">
					<span
						class="text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 shrink-0 mt-0.5 {line.kind ===
						'write'
							? 'bg-severity-warning-soft text-severity-warning'
							: 'bg-severity-ok-soft text-severity-ok'}"
					>
						{line.kind}
					</span>
					<span><span class="font-medium">{line.label}</span> — {line.detail}</span>
				</li>
			{/each}
		</ul>
	{/if}

	{#if !hasWrite}
		<div class="text-xs text-brand-muted">Read-only: this key cannot modify any data or configuration.</div>
	{/if}
	<div class="text-xs text-brand-muted">
		Never exposed: user management, token administration, and sync credentials — those require an
		administrator signed in to the dashboard.
	</div>
</div>
