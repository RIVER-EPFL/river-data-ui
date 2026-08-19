<script lang="ts">
	// One test case, opened for editing. The inputs are edited through the tool's own form, so a
	// case is built the way the calculation is run rather than by writing the request body by hand.
	import { untrack } from 'svelte';
	import type { ToolTestCase } from '$api/service';
	import Button from '$components/ui/Button.svelte';
	import ToolForm from '$components/tools/ToolForm.svelte';
	import CaseResultTable from '$components/tools/CaseResultTable.svelte';
	import type { CaseRun } from '$lib/tools/draft';
	import {
		buildRequestBody,
		curveSelectionsFrom,
		initFormState,
		type FormState,
		type ToolFormSpec,
	} from '$lib/tools/form';
	import type { CurveSelection } from '$components/tools/CurvePicker.svelte';

	let {
		testCase,
		spec,
		index,
		outputKeys,
		declaredConstants,
		lastRun,
		running,
		onRun,
		onAdopt,
	}: {
		/** Mutated in place: it is one element of the page's case list, which is deeply reactive. */
		testCase: ToolTestCase;
		spec: ToolFormSpec;
		index: number;
		outputKeys: string[];
		declaredConstants: string[];
		lastRun: CaseRun | null;
		running: boolean;
		onRun: () => void;
		/** Take the last run's results as this case's expectation. */
		onAdopt: () => void;
	} = $props();

	const id = (part: string) => `tm-case-${index}-${part}`;

	// Every buffer below is seeded once from the stored case; the effect and the write-back
	// handlers carry edits the other way. The parent remounts this editor when it replaces a case.
	let form = $state<FormState>(untrack(() => initFormState(spec, testCase.inputs)));
	let curveSelections = $state<Record<string, CurveSelection>>(
		untrack(() => curveSelectionsFrom(spec, testCase.curves)),
	);
	let inputsError = $state('');

	// The first pass is the case as stored, so it writes nothing back: normalising a case on the
	// way in would silently drop anything the current manifest no longer declares.
	let seeded = false;
	$effect(() => {
		const built = buildRequestBody(spec, form, curveSelections);
		if (!seeded) {
			seeded = true;
			return;
		}
		if ('error' in built) {
			inputsError = built.error;
			return;
		}
		inputsError = '';
		const curveNames = new Set(spec.curves.map((c) => c.name));
		testCase.inputs = Object.fromEntries(
			Object.entries(built.body).filter(([k]) => !curveNames.has(k)),
		);
		const curves = Object.fromEntries(
			Object.entries(built.body).filter(([k]) => curveNames.has(k)),
		);
		if (Object.keys(curves).length > 0) testCase.curves = curves;
		else delete testCase.curves;
	});

	// Expected values are edited as text so a partially typed number never rewrites the case.
	type Row = { key: string; text: string };
	const asText = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v ?? null));
	let expectedRows = $state<Row[]>(
		untrack(() =>
			Object.entries(testCase.expected ?? {}).map(([key, value]) => ({ key, text: asText(value) })),
		),
	);

	function parseCell(text: string): unknown {
		const t = text.trim();
		if (t === '') return null;
		const n = Number(t);
		if (Number.isFinite(n)) return n;
		try {
			return JSON.parse(t) as unknown;
		} catch {
			return text;
		}
	}

	function writeExpected() {
		const out: Record<string, unknown> = {};
		for (const row of expectedRows) {
			const key = row.key.trim();
			if (key !== '') out[key] = parseCell(row.text);
		}
		testCase.expected = out;
	}

	function addExpected() {
		expectedRows = [...expectedRows, { key: '', text: '' }];
	}
	function removeExpected(i: number) {
		expectedRows = expectedRows.filter((_, idx) => idx !== i);
		writeExpected();
	}

	let absentText = $state(untrack(() => (testCase.absent ?? []).join(', ')));
	function writeAbsent() {
		const keys = absentText
			.split(',')
			.map((k) => k.trim())
			.filter((k) => k !== '');
		if (keys.length > 0) testCase.absent = keys;
		else delete testCase.absent;
	}

	type ConstRow = { name: string; text: string };
	let constantRows = $state<ConstRow[]>(
		untrack(() =>
			Object.entries(testCase.constants ?? {}).map(([name, value]) => ({
				name,
				text: String(value),
			})),
		),
	);

	function writeConstants() {
		const out: Record<string, number> = {};
		for (const row of constantRows) {
			const name = row.name.trim();
			const value = Number(row.text);
			if (name !== '' && Number.isFinite(value)) out[name] = value;
		}
		if (Object.keys(out).length > 0) testCase.constants = out;
		else delete testCase.constants;
	}

	function pinAllConstants() {
		const held = new Map(constantRows.map((r) => [r.name, r]));
		constantRows = declaredConstants.map((name) => held.get(name) ?? { name, text: '' });
	}

	// The server reads the catalog unless an override names every declared constant, so a partial
	// list is a case that does not do what its author meant.
	const constantsIncomplete = $derived(
		constantRows.length > 0 && declaredConstants.some((c) => !constantRows.some((r) => r.name === c)),
	);
</script>

<div class="border-t border-brand-divider p-3 space-y-3 bg-brand-bg/40">
	<div class="flex flex-col gap-1">
		<label for={id('name')} class="text-sm font-medium">Case name</label>
		<input
			id={id('name')}
			type="text"
			value={testCase.name ?? ''}
			oninput={(e) => (testCase.name = e.currentTarget.value)}
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-sm"
		/>
	</div>

	<div>
		<p class="text-sm font-medium mb-1">Inputs</p>
		<ToolForm {spec} bind:form bind:curveSelections idPrefix={id('in')} />
		{#if inputsError}
			<p class="text-xs text-severity-alarm mt-1">{inputsError}</p>
		{/if}
	</div>

	<div class="space-y-1">
		<div class="flex items-baseline justify-between gap-2">
			<p class="text-sm font-medium">Expected outputs</p>
			{#if lastRun?.results}
				<Button variant="ghost" size="sm" class="text-brand-primary" onclick={onAdopt}>
					Use the last run's results
				</Button>
			{/if}
		</div>
		<datalist id={id('keys')}>
			{#each outputKeys as key (key)}<option value={key}></option>{/each}
		</datalist>
		{#each expectedRows as row, i (i)}
			<div class="flex items-center gap-1.5">
				<input
					type="text"
					bind:value={row.key}
					oninput={writeExpected}
					list={id('keys')}
					placeholder="output key"
					aria-label="Expected output key {i + 1}"
					class="w-52 px-2 py-1 border border-brand-divider rounded bg-brand-surface text-xs font-mono"
				/>
				<input
					type="text"
					bind:value={row.text}
					oninput={writeExpected}
					placeholder="value"
					aria-label="Expected value {i + 1}"
					class="w-52 px-2 py-1 border border-brand-divider rounded bg-brand-surface text-xs font-mono"
				/>
				<button
					type="button"
					onclick={() => removeExpected(i)}
					aria-label="Remove expected output {i + 1}"
					class="px-1.5 text-severity-alarm bg-transparent border border-brand-divider rounded cursor-pointer text-xs"
				>&times;</button>
			</div>
		{/each}
		<Button variant="ghost" size="sm" class="text-brand-primary" onclick={addExpected}>
			+ Add expected output
		</Button>
	</div>

	<div class="flex flex-col gap-1">
		<label for={id('absent')} class="text-sm font-medium">Outputs expected absent</label>
		<input
			id={id('absent')}
			type="text"
			bind:value={absentText}
			oninput={writeAbsent}
			placeholder="comma separated output keys"
			class="px-3 py-1.5 border border-brand-divider rounded-md bg-brand-surface text-xs font-mono"
		/>
	</div>

	<div class="space-y-1">
		<div class="flex items-baseline justify-between gap-2">
			<p class="text-sm font-medium">Constants</p>
			{#if declaredConstants.length > 0}
				<Button variant="ghost" size="sm" class="text-brand-primary" onclick={pinAllConstants}>
					Pin every declared constant
				</Button>
			{/if}
		</div>
		<p class="text-xs text-brand-muted">
			Left empty, the case reads the constants table. Pinned values make it reproducible against
			a catalog that later changes.
		</p>
		{#each constantRows as row, i (i)}
			<div class="flex items-center gap-1.5">
				<input
					type="text"
					bind:value={row.name}
					oninput={writeConstants}
					placeholder="constant name"
					aria-label="Constant name {i + 1}"
					class="w-52 px-2 py-1 border border-brand-divider rounded bg-brand-surface text-xs font-mono"
				/>
				<input
					type="number"
					step="any"
					bind:value={row.text}
					oninput={writeConstants}
					placeholder="value"
					aria-label="Constant value {i + 1}"
					class="w-52 px-2 py-1 border border-brand-divider rounded bg-brand-surface text-xs font-mono"
				/>
				<button
					type="button"
					onclick={() => {
						constantRows = constantRows.filter((_, idx) => idx !== i);
						writeConstants();
					}}
					aria-label="Remove constant {i + 1}"
					class="px-1.5 text-severity-alarm bg-transparent border border-brand-divider rounded cursor-pointer text-xs"
				>&times;</button>
			</div>
		{/each}
		<Button
			variant="ghost"
			size="sm"
			class="text-brand-primary"
			onclick={() => (constantRows = [...constantRows, { name: '', text: '' }])}
		>+ Add constant</Button>
		{#if constantsIncomplete}
			<p class="text-xs text-severity-warning-text">
				An override has to name every declared constant, or the run falls back to the catalog.
			</p>
		{/if}
	</div>

	<div class="flex items-center gap-2">
		<Button size="sm" onclick={onRun} disabled={running}>
			{running ? 'Running…' : 'Run this case'}
		</Button>
	</div>

	{#if lastRun}
		<CaseResultTable rows={lastRun.rows} failure={lastRun.failure} />
	{/if}
</div>
