<script lang="ts">
	import { onMount } from 'svelte';
	import { api, type StandardCurve } from '$api/crud';
	import { ApiError } from '$api/client';
	import { me } from '$auth/me.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import Button from '$components/ui/Button.svelte';
	import ConfirmPopover from '$components/ui/ConfirmPopover.svelte';
	import ErrorNotice from '$components/ui/ErrorNotice.svelte';
	import PaginationControls from '$components/ui/PaginationControls.svelte';
	import CopyStandardCurvesDialog from '$components/dialogs/CopyStandardCurvesDialog.svelte';
	import {
		curveEquation,
		curveLabel,
		apiMessage,
		emptyCurveForm,
		parseCurveForm,
		uniqueCurveName,
		type CurveForm,
	} from '$lib/standardCurves';

	// A standard curve belongs to one instrument and is picked by hand for a single measurement, so
	// this list is always scoped to `sensorId` and has no time axis to order by; newest first is the
	// only ordering that means anything here.
	let {
		sensorId,
		sensorName,
		focusCurveId = null,
	}: {
		sensorId: string;
		sensorName: string;
		/** Curve to highlight, from the ?tab=curves&curve=<id> deep link. */
		focusCurveId?: string | null;
	} = $props();

	const PER_PAGE = 25;

	let curves = $state<StandardCurve[]>([]);
	let total = $state(0);
	let page = $state(1);
	let loading = $state(true);
	let listError = $state('');
	let copyOpen = $state(false);

	const canWrite = $derived(me.can('writeFieldMetadata'));
	const existingNames = $derived(curves.map((c) => c.name).filter((n): n is string => !!n));

	async function load() {
		loading = true;
		listError = '';
		try {
			const res = await api.standardCurves.list({
				page,
				perPage: PER_PAGE,
				filter: { sensor_id: sensorId },
				sort: ['created_at', 'DESC'],
			});
			curves = res.data;
			total = res.total;
		} catch (e) {
			listError = apiMessage(e);
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function changePage(p: number) {
		page = p;
		void load();
	}

	// ─── Create, which is also duplicate and corrected copy ───
	// One form serves all three: a duplicate is a create seeded from another row's values, and that is
	// exactly what an operator needs when an edit is refused because the curve is already in use.
	let createOpen = $state(false);
	let form = $state<CurveForm>({ ...emptyCurveForm });
	let formError = $state('');
	let saving = $state(false);

	function openCreate(seed?: Partial<CurveForm>) {
		form = { ...emptyCurveForm, ...seed };
		formError = '';
		createOpen = true;
	}

	function formOf(curve: StandardCurve): CurveForm {
		return {
			name: curve.name ?? '',
			slope: String(curve.slope),
			intercept: String(curve.intercept),
			r_squared: curve.r_squared == null ? '' : String(curve.r_squared),
			notes: curve.notes ?? '',
		};
	}

	function openDuplicate(curve: StandardCurve, seed?: CurveForm) {
		openCreate({
			...(seed ?? formOf(curve)),
			name: uniqueCurveName(curveLabel(curve), existingNames),
		});
	}

	async function saveCreate() {
		const parsed = parseCurveForm(form);
		if ('error' in parsed) {
			formError = parsed.error;
			return;
		}
		saving = true;
		formError = '';
		try {
			await api.standardCurves.create({
				sensor_id: sensorId,
				...parsed.values,
				// The API stores created_by verbatim and freezes it on first use, so the column stays
				// permanently empty unless the dashboard sends it here.
				created_by: me.data?.email ?? null,
			});
			toastStore.success('Standard curve added');
			createOpen = false;
			form = { ...emptyCurveForm };
			page = 1;
			await load();
		} catch (e) {
			formError = apiMessage(e);
		} finally {
			saving = false;
		}
	}

	// ─── Edit and delete, and the refusal they can meet ───
	// A curve any reading was corrected with is frozen (notes excepted) and cannot be deleted. The API
	// reports that state only by refusing the write, so the refusal is caught per row and explained
	// where the operator clicked, alongside the corrected-copy path they actually need.
	let editingId = $state<string | null>(null);
	let editForm = $state<CurveForm>({ ...emptyCurveForm });
	let rowError = $state<{ id: string; message: string; seed: CurveForm | null } | null>(null);

	function startEdit(curve: StandardCurve) {
		editingId = curve.id;
		rowError = null;
		editForm = formOf(curve);
	}

	async function saveEdit(curve: StandardCurve) {
		const parsed = parseCurveForm(editForm);
		if ('error' in parsed) {
			rowError = { id: curve.id, message: parsed.error, seed: null };
			return;
		}
		saving = true;
		try {
			await api.standardCurves.update(curve.id, parsed.values);
			toastStore.success('Standard curve updated');
			editingId = null;
			rowError = null;
			await load();
		} catch (e) {
			rowError = {
				id: curve.id,
				message: apiMessage(e),
				// A 400 is the freeze: keep what was typed so the corrected copy carries it.
				seed: e instanceof ApiError && e.status === 400 ? { ...editForm } : null,
			};
		} finally {
			saving = false;
		}
	}

	async function deleteCurve(curve: StandardCurve) {
		try {
			await api.standardCurves.remove(curve.id);
			toastStore.success('Standard curve deleted');
			rowError = null;
			await load();
		} catch (e) {
			rowError = { id: curve.id, message: apiMessage(e), seed: null };
		}
	}

	function correctedCopyFrom(curve: StandardCurve) {
		const seed = rowError?.seed ?? undefined;
		editingId = null;
		rowError = null;
		openDuplicate(curve, seed);
	}
</script>

<div class="space-y-3">
	<div class="flex items-start gap-3 flex-wrap">
		<p class="text-sm text-brand-muted max-w-2xl">
			Curves belong to this instrument and are chosen by hand when a grab sample is entered, never
			by time.
		</p>
		{#if canWrite}
			<div class="flex gap-2 ml-auto">
				<Button onclick={() => (copyOpen = true)}>Copy curves…</Button>
				<Button variant="primary" onclick={() => (createOpen ? (createOpen = false) : openCreate())}>
					{createOpen ? 'Cancel' : 'Add curve'}
				</Button>
			</div>
		{/if}
	</div>

	{#if canWrite && curves.length > 0}
		<p class="text-xs text-brand-muted max-w-2xl">
			A curve freezes once a reading is corrected with it: only its notes stay editable, and it
			cannot be deleted. Correcting one means adding a new curve and re-entering the affected
			measurements against it. The API does not report which curves are in use, so Edit and Delete
			stay on every row and explain themselves if refused. Duplicating always works.
		</p>
	{/if}

	{#if listError}
		<ErrorNotice message={listError} />
	{/if}

	{#if createOpen}
		<div class="rounded-md border border-brand-primary/30 bg-brand-primary/5 p-4 space-y-3">
			<h3 class="text-sm font-semibold">New standard curve</h3>
			<div class="grid grid-cols-2 gap-3 max-w-2xl">
				<label class="flex flex-col gap-1 text-xs text-brand-muted col-span-2">
					Name
					<input type="text" bind:value={form.name} placeholder="Plate or series this curve was fitted from" class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" />
				</label>
				<label class="flex flex-col gap-1 text-xs text-brand-muted">
					Slope
					<input type="number" step="any" bind:value={form.slope} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm font-mono" />
				</label>
				<label class="flex flex-col gap-1 text-xs text-brand-muted">
					Intercept
					<input type="number" step="any" bind:value={form.intercept} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm font-mono" />
				</label>
				<label class="flex flex-col gap-1 text-xs text-brand-muted">
					R² <span class="text-[10px]">(optional)</span>
					<input type="number" step="any" bind:value={form.r_squared} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm font-mono" />
				</label>
				<label class="flex flex-col gap-1 text-xs text-brand-muted">
					Notes <span class="text-[10px]">(optional)</span>
					<input type="text" bind:value={form.notes} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" />
				</label>
			</div>
			{#if formError}
				<ErrorNotice message={formError} />
			{/if}
			<div class="flex items-center gap-3">
				<Button variant="primary" onclick={saveCreate} disabled={saving}>{saving ? 'Saving…' : 'Add curve'}</Button>
				<Button variant="ghost" onclick={() => (createOpen = false)}>Cancel</Button>
				<span class="text-[11px] text-brand-muted">Recorded against {sensorName}.</span>
			</div>
		</div>
	{/if}

	{#if loading}
		<p class="text-brand-muted text-sm">Loading…</p>
	{:else if curves.length === 0 && !createOpen}
		<div class="rounded-md border border-brand-divider bg-brand-surface px-4 py-8 text-center space-y-3">
			<h3 class="text-sm font-semibold">No standard curves on this instrument.</h3>
			<p class="text-sm text-brand-muted max-w-xl mx-auto">
				Add one here, or copy a curve from another instrument.
			</p>
			{#if canWrite}
				<div class="flex gap-2 justify-center">
					<Button variant="primary" onclick={() => openCreate()}>Add curve</Button>
					<Button onclick={() => (copyOpen = true)}>Copy curves…</Button>
				</div>
			{/if}
		</div>
	{:else if curves.length > 0}
		<div class="rounded-md border border-brand-divider bg-brand-surface overflow-hidden">
			<table class="w-full text-sm">
				<thead><tr class="bg-brand-bg border-b border-brand-divider">
					<th class="text-left px-4 py-2 font-semibold">Name</th>
					<th class="text-left px-4 py-2 font-semibold">Equation</th>
					<th class="text-left px-4 py-2 font-semibold">R²</th>
					<th class="text-left px-4 py-2 font-semibold">Created</th>
					<th class="text-left px-4 py-2 font-semibold">Created by</th>
					<th class="text-left px-4 py-2 font-semibold">Notes</th>
					{#if canWrite}<th class="text-left px-4 py-2 font-semibold">Actions</th>{/if}
				</tr></thead>
				<tbody>
					{#each curves as curve (curve.id)}
						<tr class="border-b border-brand-divider last:border-b-0 {curve.id === focusCurveId ? 'bg-brand-primary/5' : ''}">
							<td class="px-4 py-2">{curveLabel(curve)}</td>
							<td class="px-4 py-2 font-mono text-xs">{curveEquation(curve)}</td>
							<td class="px-4 py-2 font-mono text-xs">{curve.r_squared ?? 'None'}</td>
							<td class="px-4 py-2 text-xs text-brand-muted">{formatDateTime(curve.created_at)}</td>
							<td class="px-4 py-2 text-xs text-brand-muted">{curve.created_by ?? 'None'}</td>
							<td class="px-4 py-2 text-xs text-brand-muted">{curve.notes ?? 'None'}</td>
							{#if canWrite}
								<td class="px-4 py-2">
									<div class="flex gap-3">
										<Button variant="ghost" size="sm" class="text-brand-primary" onclick={() => openDuplicate(curve)}>Duplicate</Button>
										<Button variant="ghost" size="sm" class="text-brand-primary" onclick={() => (editingId === curve.id ? (editingId = null) : startEdit(curve))}>{editingId === curve.id ? 'Close' : 'Edit'}</Button>
										<ConfirmPopover
											message="Delete this standard curve? Refused if any reading was corrected with it."
											confirmLabel="Delete"
											onconfirm={() => deleteCurve(curve)}
										>
											<Button variant="ghost" size="sm" class="text-severity-alarm">Delete</Button>
										</ConfirmPopover>
									</div>
								</td>
							{/if}
						</tr>
						{#if editingId === curve.id}
							<tr class="border-b border-brand-divider bg-brand-bg/40">
								<td colspan={canWrite ? 7 : 6} class="px-4 py-3 space-y-3">
									<div class="grid grid-cols-4 gap-3">
										<label class="flex flex-col gap-1 text-xs text-brand-muted col-span-2">Name<input type="text" bind:value={editForm.name} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" /></label>
										<label class="flex flex-col gap-1 text-xs text-brand-muted">Slope<input type="number" step="any" bind:value={editForm.slope} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm font-mono" /></label>
										<label class="flex flex-col gap-1 text-xs text-brand-muted">Intercept<input type="number" step="any" bind:value={editForm.intercept} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm font-mono" /></label>
										<label class="flex flex-col gap-1 text-xs text-brand-muted">R²<input type="number" step="any" bind:value={editForm.r_squared} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm font-mono" /></label>
										<label class="flex flex-col gap-1 text-xs text-brand-muted col-span-3">Notes<input type="text" bind:value={editForm.notes} class="px-2 py-1 border border-brand-divider rounded bg-brand-surface text-sm" /></label>
									</div>
									<div class="flex items-center gap-3">
										<Button variant="primary" onclick={() => saveEdit(curve)} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
										<Button variant="ghost" onclick={() => { editingId = null; rowError = null; }}>Cancel</Button>
										<span class="text-[11px] text-brand-muted">Notes stay editable after the curve is used; everything else does not.</span>
									</div>
								</td>
							</tr>
						{/if}
						{#if rowError?.id === curve.id}
							<tr class="border-b border-brand-divider bg-brand-bg/40">
								<td colspan={canWrite ? 7 : 6} class="px-4 py-3">
									<ErrorNotice>
										<div class="space-y-2">
											<p>{rowError.message}</p>
											<div class="flex gap-2">
												<Button variant="primary" size="sm" onclick={() => correctedCopyFrom(curve)}>Create corrected copy</Button>
												<Button variant="ghost" size="sm" onclick={() => (rowError = null)}>Dismiss</Button>
											</div>
										</div>
									</ErrorNotice>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
		<PaginationControls {total} {page} perPage={PER_PAGE} onPageChange={changePage} />
	{/if}
</div>

<CopyStandardCurvesDialog
	bind:open={copyOpen}
	targetSensorId={sensorId}
	targetSensorName={sensorName}
	{existingNames}
	onsuccess={() => { page = 1; void load(); }}
/>
