<script lang="ts">
	import { base } from '$app/paths';
	import { page } from '$app/state';
	import CrudForm from '$components/crud/CrudForm.svelte';
	import ConstantConsequence from '$components/constants/ConstantConsequence.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import { api } from '$api/crud';
	import { me } from '$auth/me.svelte';
	import { getCalculationClosure } from '$api/service';
	import { valueChangeConsequence, type StoredUsage } from '$lib/constants/consequence';
	import { AUTHOR_CALCULATIONS, CONSTANTS_REFUSED } from '$lib/toolbox/authoring';

	let name = $state('');
	let storedValue = $state<number | null>(null);
	let stored = $state<StoredUsage | undefined>(undefined);
	let confirming = $state(false);
	let decide: ((go: boolean) => void) | null = null;

	$effect(() => {
		const id = page.params.id;
		if (!id) return;
		api.constants
			.get(id)
			.then((c) => {
				name = c.name;
				storedValue = c.value;
			})
			.catch(() => (name = ''));
		getCalculationClosure({ constant_id: id })
			.then((c) => (stored = c.stored ?? undefined))
			.catch(() => (stored = undefined));
	});

	// A value change recomputes every visit whose provenance names the constant, so the counts go
	// in front of the administrator before the write rather than in a job they find afterwards.
	function confirmSave(payload: Record<string, unknown>): Promise<boolean> {
		const next = payload.value;
		if (typeof next !== 'number' || next === storedValue) return Promise.resolve(true);
		confirming = true;
		return new Promise<boolean>((resolve) => {
			decide = (go) => {
				confirming = false;
				decide = null;
				resolve(go);
			};
		});
	}

	const consequence = $derived(valueChangeConsequence(name ? [name] : [], stored));
</script>

<svelte:head><title>Edit Constant | RIVER Data</title></svelte:head>

<ConstantConsequence {name} id={page.params.id} />

{#if !me.can(AUTHOR_CALCULATIONS)}
	<ErrorNotice message={CONSTANTS_REFUSED} />
{:else}
	<CrudForm
		client={api.constants}
		entityId={page.params.id}
		title="Edit Constant"
		backHref="{base}/parameters?tab=constants"
		fields={[
			{ key: 'name', label: 'Name', required: true, helperText: 'Identifier used in formulas, e.g. molar_weight_o2' },
			{ key: 'value', label: 'Value', type: 'number', required: true, step: 'any', helperText: 'Numeric constant value' },
			{ key: 'units', label: 'Units', helperText: 'Unit of the constant, e.g. g/mol' },
			{ key: 'description', label: 'Description', type: 'textarea' },
		]}
		{confirmSave}
	/>
{/if}

<Dialog bind:open={confirming} title="Recompute what this constant produced?" maxWidth="xs">
	<p class="text-sm">{consequence}</p>
	<p class="text-sm text-brand-muted mt-2">
		The recompute runs as a tracked job; its progress is in the operations panel.
	</p>
	{#snippet actions()}
		<Button variant="ghost" onclick={() => decide?.(false)}>Cancel</Button>
		<Button variant="primary" onclick={() => decide?.(true)}>Save and recompute</Button>
	{/snippet}
</Dialog>
