<script lang="ts">
	// Raw JSON over the same object the builder edits. Both directions stay live: builder edits
	// reformat the text, and text that parses is handed straight back. While the text does not
	// parse it is left exactly as typed, so a half-finished edit is never reformatted away.
	let {
		id,
		label,
		value,
		rows = 14,
		onapply,
	}: {
		id: string;
		label: string;
		value: unknown;
		rows?: number;
		onapply: (parsed: unknown) => void;
	} = $props();

	const serialize = (v: unknown) => JSON.stringify(v ?? {}, null, 2);

	// Seeded by the sync effect below, which also runs on mount.
	let text = $state('');
	let error = $state('');
	// Plain variable, not state: it gates the sync effect and must not retrigger it.
	let editing = false;

	$effect(() => {
		const next = serialize(value);
		if (!editing) text = next;
	});

	function onInput() {
		editing = true;
		try {
			const parsed: unknown = JSON.parse(text);
			error = '';
			onapply(parsed);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Invalid JSON';
		}
	}

	function onBlur() {
		// Give up the buffer only once it parses; otherwise the reformat would discard the edit.
		if (!error) editing = false;
	}
</script>

<div class="flex flex-col gap-1">
	<label for={id} class="text-sm font-medium">{label}</label>
	<textarea
		{id}
		{rows}
		bind:value={text}
		oninput={onInput}
		onblur={onBlur}
		spellcheck="false"
		class="px-3 py-2 border {error
			? 'border-severity-alarm'
			: 'border-brand-divider'} rounded-md bg-brand-bg text-xs font-mono leading-5"
	></textarea>
	{#if error}<p class="text-xs text-severity-alarm">{error}</p>{/if}
</div>
