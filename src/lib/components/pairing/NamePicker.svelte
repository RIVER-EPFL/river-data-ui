<script lang="ts">
	import MappingSelect, { type MappingGroup } from '$components/ui/MappingSelect.svelte';
	import { focusOnMount } from '$lib/focus';

	// The review's one control for what a source thing becomes: an existing row, one this plan
	// creates, or a name typed in. Every tab uses it, so a rename reads the same everywhere.
	let {
		value,
		groups,
		name,
		status,
		noneLabel = null,
		ariaLabel,
		onpick,
		onrename,
	}: {
		value: string;
		groups: MappingGroup[];
		/** The name the plan carries now, which the typed name starts from. */
		name: string;
		status: 'existing' | 'new' | 'unset';
		/** An empty-valued option, for where attaching nothing is a real answer. */
		noneLabel?: string | null;
		ariaLabel: string;
		onpick: (value: string) => void;
		onrename: (name: string) => void;
	} = $props();

	let typing = $state(false);
	let typed = $state('');

	function commit() {
		if (!typing) return;
		typing = false;
		const next = typed.trim();
		if (next && next !== name) onrename(next);
	}
</script>

{#if typing}
	<input
		type="text"
		bind:value={typed}
		onkeydown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') typing = false; }}
		onblur={commit}
		aria-label="New name for {name}"
		class="px-2 py-1 border border-brand-primary rounded text-xs bg-brand-surface w-full max-w-[240px]"
		use:focusOnMount
	/>
{:else}
	<MappingSelect
		{value}
		{groups}
		{status}
		{noneLabel}
		{ariaLabel}
		customLabel="Custom name…"
		onchange={(v) => {
			if (v === '__custom__') { typed = name; typing = true; return; }
			if (v !== value) onpick(v);
		}}
	/>
{/if}
