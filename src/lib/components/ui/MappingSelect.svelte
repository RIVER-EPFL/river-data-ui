<script lang="ts">
	// One mapping decision in the pairing review: what this source thing becomes in the database.
	//
	// The sections are always in the same order and always complete, so a choice is reversible: the
	// creation this plan proposes stays listed while an existing row is selected, and picking it
	// again goes back. Every option is a transition; none of them is a no-op.
	export type MappingOption = { value: string; label: string; title?: string };
	export type MappingGroup = { label: string; options: MappingOption[] };

	let {
		value,
		groups,
		customLabel = null,
		noneLabel = null,
		onchange,
		ariaLabel,
		title,
		status = 'neutral',
		size = 'md',
		class: klass = '',
	}: {
		value: string;
		groups: MappingGroup[];
		/** Adds a "Custom name…" option, reported to `onchange` as `__custom__`. */
		customLabel?: string | null;
		/** Adds an empty-valued option for the cases where "attached to nothing" is a real answer. */
		noneLabel?: string | null;
		onchange: (value: string) => void;
		ariaLabel: string;
		title?: string;
		/** Border tone: what the current selection means, not whether the control is valid. */
		status?: 'existing' | 'new' | 'unset' | 'neutral';
		size?: 'sm' | 'md';
		class?: string;
	} = $props();

	const border = $derived(
		status === 'existing'
			? 'border-severity-ok'
			: status === 'new'
				? 'border-severity-warning'
				: status === 'unset'
					? 'border-severity-warning-border'
					: 'border-brand-divider',
	);
	const dims = $derived(size === 'sm' ? 'px-1 py-0.5 text-xs' : 'px-2 py-1 text-xs');
	// A selection the caller holds that no group lists would silently reset the control to its
	// first option, so it is carried as its own entry instead.
	const known = $derived(
		value === '' ||
			value === '__custom__' ||
			groups.some((g) => g.options.some((o) => o.value === value)),
	);
</script>

<select
	{value}
	{title}
	aria-label={ariaLabel}
	onchange={(e) => onchange((e.currentTarget as HTMLSelectElement).value)}
	class="rounded bg-brand-surface border {border} {dims} max-w-[240px] w-full cursor-pointer {klass}"
>
	{#if !known}
		<option {value}>{value}</option>
	{/if}
	{#if noneLabel}
		<option value="">{noneLabel}</option>
	{:else if value === ''}
		<option value="" disabled>choose…</option>
	{/if}
	{#each groups as group (group.label)}
		{#if group.options.length > 0}
			<optgroup label={group.label}>
				{#each group.options as option (option.value)}
					<option value={option.value} title={option.title}>{option.label}</option>
				{/each}
			</optgroup>
		{/if}
	{/each}
	{#if customLabel}
		<option value="__custom__">{customLabel}</option>
	{/if}
</select>
