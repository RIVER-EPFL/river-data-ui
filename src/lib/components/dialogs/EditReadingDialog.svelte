<script lang="ts">
	import {
		commitEdit,
		inspectEdits,
		previewEdit,
		reloadToolRun,
		type EditDecisionBody,
		type EditOptionKind,
		type EditPreviewResponse,
		type EditSelection,
		type InspectedRow,
	} from '$api/service';
	import {
		EDIT_METHODS,
		commonOptions,
		fieldLabel,
		isRoute,
		movedFields,
		needsTarget,
		needsValue,
		previewIsEmpty,
		selectionRoute,
	} from '$lib/provenance/edits';
	import { formatDateTime } from '$lib/utils';
	import { toastStore } from '$lib/stores/toast.svelte';
	import Button from '$components/ui/Button.svelte';
	import Dialog from '$components/ui/Dialog.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';

	// The one edit surface (Q8, M60): what produced the value decides what may be done to it, the
	// preview is the write's own arithmetic, and the commit is held to the preview of itself.
	let {
		open = $bindable(false),
		selection,
		title = 'Edit reading',
		onsuccess,
	}: {
		open: boolean;
		/** The readings this edit covers: a stream, a slot and window, or explicit keys. */
		selection: EditSelection;
		title?: string;
		onsuccess?: () => void;
	} = $props();

	let loading = $state(false);
	let error = $state('');
	let rows = $state<InspectedRow[]>([]);
	let chosen = $state<EditOptionKind | null>(null);
	let value = $state('');
	let targetId = $state('');
	let reason = $state('');
	let preview = $state<EditPreviewResponse | null>(null);
	let previewError = $state('');
	let previewing = $state(false);
	let committing = $state(false);
	let previewSeq = 0;

	const route = $derived(selectionRoute(rows));
	const options = $derived(commonOptions(rows));
	const method = $derived(chosen ? EDIT_METHODS[chosen] : null);
	const toolRunId = $derived(rows.find((r) => r.tool_run_id)?.tool_run_id ?? null);

	$effect(() => {
		if (!open) return;
		chosen = null;
		value = '';
		targetId = '';
		reason = '';
		preview = null;
		previewError = '';
		void load();
	});

	async function load() {
		loading = true;
		error = '';
		try {
			rows = (await inspectEdits(selection)).rows;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			rows = [];
		} finally {
			loading = false;
		}
	}

	/** The decision as it stands, or null while it is still missing what it carries. */
	function decision(): EditDecisionBody | null {
		if (!chosen || isRoute(chosen)) return null;
		if (needsValue(chosen)) {
			const parsed = Number(value);
			if (value.trim() === '' || Number.isNaN(parsed)) return null;
			return { kind: chosen, value: parsed, reason: reason || undefined };
		}
		if (needsTarget(chosen)) {
			if (!targetId.trim()) return null;
			return { kind: chosen, target_id: targetId.trim(), reason: reason || undefined };
		}
		return { kind: chosen, reason: reason || undefined };
	}

	// Every change re-previews: what is shown is always the edit as it now stands, never the one
	// before the last keystroke.
	$effect(() => {
		const body = decision();
		if (!open || !body) {
			preview = null;
			previewError = '';
			return;
		}
		const seq = ++previewSeq;
		previewing = true;
		previewEdit(selection, body)
			.then((r) => {
				if (seq !== previewSeq) return;
				preview = r;
				previewError = '';
			})
			.catch((e: unknown) => {
				if (seq !== previewSeq) return;
				preview = null;
				previewError = e instanceof Error ? e.message : String(e);
			})
			.finally(() => {
				if (seq === previewSeq) previewing = false;
			});
	});

	async function commit() {
		const body = decision();
		if (!body || !preview) return;
		committing = true;
		try {
			const result = await commitEdit(selection, body, preview.preview_id);
			toastStore.success(
				`${result.rows_decided} reading${result.rows_decided === 1 ? '' : 's'} edited`,
			);
			open = false;
			onsuccess?.();
		} catch (e) {
			previewError = e instanceof Error ? e.message : String(e);
		} finally {
			committing = false;
		}
	}

	async function reopen() {
		if (!toolRunId) return;
		try {
			const run = await reloadToolRun(toolRunId);
			sessionStorage.setItem('tool-reload', JSON.stringify(run));
			open = false;
			window.location.href = `/tools?tool=${encodeURIComponent(run.tool)}&reload=${toolRunId}`;
		} catch (e) {
			previewError = e instanceof Error ? e.message : String(e);
		}
	}
</script>

<Dialog bind:open {title} maxWidth="md">
	{#if loading}
		<p class="text-sm text-gray-500">Reading the record…</p>
	{:else if error}
		<ErrorNotice message={error} />
	{:else if route === 'empty'}
		<p class="text-sm text-gray-500">Nothing is stored at that selection.</p>
	{:else}
		<div class="space-y-4">
			<p class="text-sm text-gray-600 dark:text-gray-300">
				{#if route === 'tool'}
					A calculation produced {rows.length === 1 ? 'this value' : 'these values'}, so
					{rows.length === 1 ? 'it is' : 'they are'} corrected by reopening the run rather than
					typed over here.
				{:else if route === 'mixed'}
					This selection mixes calculated values with entered ones, so only what every reading
					allows is offered.
				{:else}
					Nothing computed {rows.length === 1 ? 'this value' : 'these values'}, so
					{rows.length === 1 ? 'it is' : 'they are'} corrected here.
				{/if}
			</p>

			<fieldset class="space-y-2">
				<legend class="text-xs font-semibold uppercase tracking-wide text-gray-500">
					What to do
				</legend>
				{#each options as option (option)}
					<label class="flex items-start gap-2 text-sm">
						<input type="radio" name="edit-option" value={option} bind:group={chosen} />
						<span>
							<span class="font-medium">{EDIT_METHODS[option].label}</span>
							<span class="block text-xs text-gray-500">{EDIT_METHODS[option].changes}</span>
							<span class="block text-xs text-gray-400">{EDIT_METHODS[option].leaves}</span>
						</span>
					</label>
				{/each}
			</fieldset>

			{#if chosen === 'reopen_run' && toolRunId}
				<Button variant="primary" onclick={reopen}>Open the calculation</Button>
			{:else if chosen === 'edit_deployment' || chosen === 'edit_calibration'}
				<p class="text-sm text-gray-500">{method?.leaves}</p>
			{:else if chosen}
				{#if needsValue(chosen)}
					<label class="block text-sm">
						Corrected value
						<input
							class="mt-1 w-full rounded border px-2 py-1"
							type="number"
							step="any"
							bind:value
						/>
					</label>
				{/if}
				{#if needsTarget(chosen)}
					<label class="block text-sm">
						Standard curve
						<input class="mt-1 w-full rounded border px-2 py-1" bind:value={targetId} />
					</label>
				{/if}
				<label class="block text-sm">
					Reason
					<input class="mt-1 w-full rounded border px-2 py-1" bind:value={reason} />
				</label>

				{#if previewing}
					<p class="text-sm text-gray-500">Working out what this changes…</p>
				{:else if previewError}
					<ErrorNotice message={previewError} />
				{:else if preview}
					<div class="rounded border border-gray-200 p-3 text-sm dark:border-gray-700">
						<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
							What this changes
						</p>
						{#if previewIsEmpty(preview.rows, preview.samples)}
							<p class="text-gray-500">Nothing: the readings already stand this way.</p>
						{:else}
							{#each preview.rows as row (row.stream_id + row.time + row.replicate_index)}
								{#each movedFields(row.before, row.after) as moved (moved.field)}
									<p>
										<span class="text-gray-500"
											>{formatDateTime(row.time)} · replicate {row.replicate_index} ·
											{fieldLabel(moved.field)}</span
										>
										<span class="ml-1">{String(moved.before ?? '—')} → {String(moved.after ?? '—')}</span>
									</p>
								{/each}
							{/each}
							{#each preview.samples as sample (sample.sample_id)}
								{#each movedFields(sample.before, sample.after) as moved (moved.field)}
									<p>
										<span class="text-gray-500">Group {fieldLabel(moved.field)}</span>
										<span class="ml-1">{String(moved.before ?? '—')} → {String(moved.after ?? '—')}</span>
									</p>
								{/each}
							{/each}
						{/if}
						{#if preview.calculations.length > 0}
							<p class="mt-2 text-xs text-gray-500">
								Recomputes afterwards: {preview.calculations.map((c) => c.label).join(', ')}
							</p>
						{/if}
						<ul class="mt-2 list-disc pl-4 text-xs text-gray-400">
							{#each preview.not_previewed as note (note)}
								<li>{note}</li>
							{/each}
						</ul>
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	{#snippet actions()}
		<Button onclick={() => (open = false)}>Cancel</Button>
		{#if chosen && !isRoute(chosen)}
			<Button
				variant="primary"
				loading={committing}
				disabled={!preview || previewing || committing}
				onclick={commit}>Apply</Button
			>
		{/if}
	{/snippet}
</Dialog>
