<script lang="ts">
	import type { ToolScriptSummary } from '$api/service';

	// Which tool script the authoring page is editing. The catalog grows with the portal, so the
	// control occupies one line whatever its length and the list is reached by typing.
	let {
		scripts = [],
		selectedId = null,
		onSelect,
	}: {
		scripts?: ToolScriptSummary[];
		selectedId?: string | null;
		onSelect: (id: string) => void;
	} = $props();

	let open = $state(false);
	let search = $state('');
	let container = $state<HTMLDivElement | null>(null);
	let input = $state<HTMLInputElement | null>(null);

	const selected = $derived(scripts.find((s) => s.id === selectedId) ?? null);

	const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

	const matches = $derived.by(() => {
		const q = norm(search);
		const pool = q
			? scripts.filter(
					(s) =>
						norm(s.label).includes(q) ||
						norm(s.name).includes(q) ||
						norm(s.description).includes(q),
				)
			: scripts;
		return [...pool].sort((a, b) => a.label.localeCompare(b.label));
	});

	function versionLabel(s: ToolScriptSummary): string {
		return s.active_version_no != null ? `Version ${s.active_version_no}` : 'No active version';
	}

	function openList() {
		open = true;
		search = '';
		queueMicrotask(() => input?.focus());
	}

	function choose(s: ToolScriptSummary) {
		open = false;
		search = '';
		onSelect(s.id);
	}
</script>

<div
	class="relative min-w-0 grow max-w-xl"
	bind:this={container}
	onfocusout={() => {
		// Checked after the tick, not from relatedTarget: opening the list unmounts the trigger, and
		// focus is only on the search field it mounted in its place once that update has landed.
		setTimeout(() => {
			if (container && !container.contains(document.activeElement)) open = false;
		}, 0);
	}}
>
	{#if open}
		<input
			type="search"
			bind:this={input}
			bind:value={search}
			aria-label="Search tool scripts"
			placeholder="Search by label, name or description…"
			onkeydown={(e) => {
				if (e.key === 'Escape') open = false;
				else if (e.key === 'Enter' && matches.length > 0) choose(matches[0]);
			}}
			class="w-full px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
		/>
	{:else}
		<button
			type="button"
			onclick={openList}
			class="w-full flex items-center gap-2 px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm text-left cursor-pointer hover:bg-brand-bg"
		>
			{#if selected}
				<span class="font-medium truncate">{selected.label}</span>
				<span class="font-mono text-xs text-brand-muted truncate">{selected.name}</span>
				<span class="grow"></span>
				<span class="text-xs text-brand-muted whitespace-nowrap">{versionLabel(selected)}</span>
			{:else}
				<span class="text-brand-muted">Select a tool script…</span>
				<span class="grow"></span>
			{/if}
			<span aria-hidden="true" class="text-brand-muted">▾</span>
		</button>
	{/if}

	<!-- Overlaid rather than in flow, so opening the list does not move the editor below it. -->
	{#if open}
		<div
			class="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-md border border-brand-divider bg-brand-surface shadow-md"
		>
			{#each matches as s (s.id)}
				<button
					type="button"
					onclick={() => choose(s)}
					class="w-full text-left px-3 py-1.5 cursor-pointer hover:bg-brand-bg {s.id === selectedId
						? 'bg-brand-primary/10'
						: ''}"
				>
					<div class="flex items-baseline gap-2">
						<span class="text-sm font-medium truncate">{s.label}</span>
						<span class="font-mono text-xs text-brand-muted truncate">{s.name}</span>
						<span class="grow"></span>
						<span class="text-xs text-brand-muted whitespace-nowrap">{versionLabel(s)}</span>
					</div>
					{#if s.description}
						<div class="text-xs text-brand-muted truncate">{s.description}</div>
					{/if}
				</button>
			{:else}
				<p class="px-3 py-2 text-sm text-brand-muted">No tool script matches that search.</p>
			{/each}
		</div>
	{/if}
</div>
