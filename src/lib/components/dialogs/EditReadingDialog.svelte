<script lang="ts">
	import {
		commitEdit,
		detachOutput,
		inspectEdits,
		overrideOutput,
		previewEdit,
		reloadToolRun,
		returnOutput,
		seasonalCheck,
		type EditDecisionBody,
		type EditOptionKind,
		type EditPreviewResponse,
		type EditSelection,
		type InspectedRow,
	} from '$api/service';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import {
		EDIT_METHODS,
		commonOptions,
		correctionCheck,
		fieldLabel,
		isDirect,
		isRoute,
		movedFields,
		needsTarget,
		needsValue,
		outputSlots,
		overrideBody,
		previewIsEmpty,
		selectionRoute,
	} from '$lib/provenance/edits';
	import { formatDateTime } from '$lib/utils';
	import { seasonalFindingLabel } from '$lib/seasonal';
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
		initial = null,
		onsuccess,
	}: {
		open: boolean;
		/** The readings this edit covers: a stream, a slot and window, or explicit keys. */
		selection: EditSelection;
		title?: string;
		/** The option to open on, when the rows offer it. */
		initial?: EditOptionKind | null;
		onsuccess?: () => void;
	} = $props();

	let loading = $state(false);
	let error = $state('');
	let rows = $state<InspectedRow[]>([]);
	let chosen = $state<EditOptionKind | null>(null);
	let value = $state<number | string | null>('');
	let targetId = $state('');
	let reason = $state('');
	let overrideReplicate = $state(0);
	let preview = $state<EditPreviewResponse | null>(null);
	let previewError = $state('');
	let previewing = $state(false);
	let committing = $state(false);
	// The decision as it was screened and previewed: a correction of grab values carries the
	// seasonal check that screened it (Q262), and the commit is held to the same one.
	let screened = $state<EditDecisionBody | null>(null);
	let seasonalWarnings = $state<string[]>([]);
	let previewSeq = 0;

	const route = $derived(selectionRoute(rows));
	const options = $derived(commonOptions(rows));
	const method = $derived(chosen ? EDIT_METHODS[chosen] : null);
	const toolRunId = $derived(rows.find((r) => r.tool_run_id)?.tool_run_id ?? null);
	const overridden = $derived(rows.find((r) => r.replicate_index === overrideReplicate) ?? rows[0]);
	const overrideRequest = $derived(
		chosen === 'override' && overridden ? overrideBody(overridden, value, reason) : null,
	);

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
			overrideReplicate = rows[0]?.replicate_index ?? 0;
			if (initial && commonOptions(rows).includes(initial)) chosen = initial;
		} catch (e) {
			error = e instanceof Error ? e.message : String(e);
			rows = [];
		} finally {
			loading = false;
		}
	}

	/** The decision as it stands, or null while it is still missing what it carries. */
	function decision(): EditDecisionBody | null {
		if (!chosen || isRoute(chosen) || isDirect(chosen)) return null;
		if (needsValue(chosen)) {
			// A number input binds a number, and an empty one binds null.
			const text = String(value ?? '').trim();
			const parsed = Number(text);
			if (text === '' || Number.isNaN(parsed)) return null;
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
		screen(body)
			.then((checked) => {
				if (seq !== previewSeq) return null;
				screened = checked;
				return previewEdit(selection, checked);
			})
			.then((r) => {
				if (seq !== previewSeq || !r) return;
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

	/** The decision with the check that screened the grab values it corrects, where it corrects any. */
	async function screen(body: EditDecisionBody): Promise<EditDecisionBody> {
		seasonalWarnings = [];
		const request = body.value == null ? null : correctionCheck(rows, body.value);
		if (!request) return body;
		const response = await seasonalCheck(request);
		seasonalWarnings = response.findings
			.filter((f) => f.warning)
			.map((f) => seasonalFindingLabel(f, 'Corrected value'));
		return { ...body, check_id: response.check_id };
	}

	async function commit() {
		const body = screened;
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

	const DIRECT_DONE: Record<string, string> = {
		detach: 'Detached from the calculation',
		return: 'Returned to the calculation',
		override: 'Calculated value overridden',
	};
	const DIRECT_ACTION: Record<string, string> = {
		detach: 'Detach',
		return: 'Return',
		override: 'Override',
	};

	/**
	 * A detach or a return, recorded by its own route for every slot instant selected; an override,
	 * for the one value picked.
	 */
	async function applyDirect() {
		if (!chosen || !isDirect(chosen)) return;
		committing = true;
		try {
			if (chosen === 'override') {
				if (!overrideRequest) return;
				await overrideOutput(overrideRequest);
			} else {
				const call = chosen === 'detach' ? detachOutput : returnOutput;
				for (const slot of outputSlots(rows)) {
					await call({ ...slot, reason: reason || undefined });
				}
			}
			toastStore.success(DIRECT_DONE[chosen]);
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
			await goto(`${base}/data-entry?tool=${encodeURIComponent(run.tool)}&reload=${toolRunId}`);
		} catch (e) {
			previewError = e instanceof Error ? e.message : String(e);
		}
	}
</script>

<Dialog bind:open {title} maxWidth="md">
	{#if loading}
		<p class="text-sm text-brand-muted">Reading the record…</p>
	{:else if error}
		<ErrorNotice message={error} />
	{:else if route === 'empty'}
		<p class="text-sm text-brand-muted">Nothing is stored at that selection.</p>
	{:else}
		<div class="space-y-4">
			<p class="text-sm text-brand-muted">
				{#if route === 'tool'}
					A calculation produced {rows.length === 1 ? 'this value' : 'these values'}, so
					{rows.length === 1 ? 'it is' : 'they are'} corrected by reopening the run rather than
					typed over here.
				{:else if route === 'detached'}
					{rows.length === 1 ? 'This slot is' : 'These slots are'} off the calculation, so
					{rows.length === 1 ? 'the value is' : 'the values are'} corrected here until
					{rows.length === 1 ? 'it is' : 'they are'} returned.
				{:else if route === 'mixed'}
					This selection mixes calculated values with entered ones, so only what every reading
					allows is offered.
				{:else}
					Nothing computed {rows.length === 1 ? 'this value' : 'these values'}, so
					{rows.length === 1 ? 'it is' : 'they are'} corrected here.
				{/if}
			</p>

			<fieldset class="space-y-2">
				<legend class="text-xs font-semibold uppercase tracking-wide text-brand-muted">
					What to do
				</legend>
				{#each options as option (option)}
					<label class="flex items-start gap-2 text-sm">
						<input type="radio" name="edit-option" value={option} bind:group={chosen} />
						<span>
							<span class="font-medium">{EDIT_METHODS[option].label}</span>
							<span class="block text-xs text-brand-muted">{EDIT_METHODS[option].changes}</span>
							<span class="block text-xs text-brand-muted">{EDIT_METHODS[option].leaves}</span>
						</span>
					</label>
				{/each}
			</fieldset>

			{#if chosen === 'reopen_run' && toolRunId}
				<Button variant="primary" onclick={reopen}>Open the calculation</Button>
			{:else if chosen === 'edit_deployment' || chosen === 'edit_calibration'}
				<p class="text-sm text-brand-muted">{method?.leaves}</p>
			{:else if chosen && isDirect(chosen)}
				{#if chosen === 'override'}
					{#if rows.length > 1}
						<label class="block text-sm">
							Replicate
							<select class="mt-1 w-full rounded border px-2 py-1" bind:value={overrideReplicate}>
								{#each rows as r (r.stream_id + r.replicate_index)}
									<option value={r.replicate_index}>{r.replicate_index} · computed {r.raw_value}</option>
								{/each}
							</select>
						</label>
					{:else if overridden}
						<p class="text-sm text-brand-muted">The calculation gave {overridden.raw_value}.</p>
					{/if}
					<label class="block text-sm">
						Value
						<input
							class="mt-1 w-full rounded border px-2 py-1"
							type="number"
							step="any"
							bind:value
						/>
					</label>
				{/if}
				<label class="block text-sm">
					Reason
					<input class="mt-1 w-full rounded border px-2 py-1" bind:value={reason} />
				</label>
				{#if previewError}<ErrorNotice message={previewError} />{/if}
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

				{#if seasonalWarnings.length > 0 && !previewing}
					<div class="rounded border border-severity-warning-border bg-severity-warning-soft p-3 text-sm">
						<p class="font-medium text-severity-warning-text">
							Outside this site's seasonal range. Look for a mistake before applying.
						</p>
						{#each seasonalWarnings as line (line)}
							<p class="text-xs">{line}</p>
						{/each}
					</div>
				{/if}
				{#if previewing}
					<p class="text-sm text-brand-muted">Working out what this changes…</p>
				{:else if previewError}
					<ErrorNotice message={previewError} />
				{:else if preview}
					<div class="rounded border border-brand-divider p-3 text-sm">
						<p class="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-muted">
							What this changes
						</p>
						{#if previewIsEmpty(preview.rows, preview.samples)}
							<p class="text-brand-muted">Nothing: the readings already stand this way.</p>
						{:else}
							{#each preview.rows as row (row.stream_id + row.time + row.replicate_index)}
								{#each movedFields(row.before, row.after) as moved (moved.field)}
									<p>
										<span class="text-brand-muted"
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
										<span class="text-brand-muted">Group {fieldLabel(moved.field)}</span>
										<span class="ml-1">{String(moved.before ?? '—')} → {String(moved.after ?? '—')}</span>
									</p>
								{/each}
							{/each}
						{/if}
						{#if preview.calculations.length > 0}
							<p class="mt-2 text-xs text-brand-muted">
								Recomputes afterwards: {preview.calculations.map((c) => c.label).join(', ')}
							</p>
						{/if}
						<ul class="mt-2 list-disc pl-4 text-xs text-brand-muted">
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
		{#if chosen && isDirect(chosen)}
			<Button
				variant="primary"
				loading={committing}
				disabled={committing || (chosen === 'override' && !overrideRequest)}
				onclick={applyDirect}>{DIRECT_ACTION[chosen]}</Button
			>
		{:else if chosen && !isRoute(chosen)}
			<Button
				variant="primary"
				loading={committing}
				disabled={!preview || previewing || committing}
				onclick={commit}>Apply</Button
			>
		{/if}
	{/snippet}
</Dialog>
