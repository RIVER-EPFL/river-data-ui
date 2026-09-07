<script lang="ts">
	import { onMount } from 'svelte';
	import { getChangeAudit, type ChangeEntry } from '$api/service';
	import { formatDateTime } from '$lib/utils';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	// What was done to one thing, by whom, and when. The subject is how the trail is keyed, so a
	// caller passes the same string the writer recorded: `parameter_group:{id}`,
	// `site_parameter:{id}`, `parameter:{id}`, `schedule:{job_name}`.
	let { subject, title = 'History' }: { subject: string; title?: string } = $props();

	let entries = $state<ChangeEntry[]>([]);
	let error = $state('');
	let loaded = $state(false);

	onMount(async () => {
		try {
			entries = await getChangeAudit(subject);
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
		} finally {
			loaded = true;
		}
	});

	// The change names what happened; the columns that moved say what it did.
	function moved(e: ChangeEntry): string[] {
		const before = (e.old_value ?? {}) as Record<string, unknown>;
		const after = (e.new_value ?? {}) as Record<string, unknown>;
		return [...new Set([...Object.keys(before), ...Object.keys(after)])]
			.filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
			.filter((k) => k !== 'updated_at');
	}
</script>

<div class="border border-brand-divider rounded-md p-3 space-y-2">
	<h3 class="font-semibold text-sm">{title}</h3>
	{#if error}
		<ErrorNotice message={error} />
	{:else if !loaded}
		<p class="text-xs text-brand-muted">Loading…</p>
	{:else if entries.length === 0}
		<p class="text-xs text-brand-muted">Nothing has been changed here since the trail began.</p>
	{:else}
		<ul class="space-y-1 text-xs">
			{#each entries as e (e.changed_at + e.change)}
				<li class="flex flex-wrap items-baseline gap-x-2">
					<span class="font-medium">{e.change}</span>
					<span class="text-brand-muted">{formatDateTime(e.changed_at)}</span>
					<span class="text-brand-muted">{e.changed_by ?? 'actor not recorded'}</span>
					{#if moved(e).length > 0}
						<span class="text-brand-muted">{moved(e).join(', ')}</span>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>
