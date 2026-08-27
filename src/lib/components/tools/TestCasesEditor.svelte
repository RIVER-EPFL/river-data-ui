<script lang="ts">
	// The version's test cases as a table, each row runnable against the unsaved script through
	// `POST /tool_scripts/draft_run`. A case run here is compared the way the server compares it
	// when it validates a stored version, so a green table is a version that will validate.
	import { type ToolManifest, type ToolTestCase, type ToolTestCases } from '$api/service';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import TestCaseEditor from '$components/tools/TestCaseEditor.svelte';
	import CaseResultTable from '$components/tools/CaseResultTable.svelte';
	import { DEFAULT_TOLERANCE, runTestCase, type CaseRun } from '$lib/tools/draft';
	import type { ToolFormSpec } from '$lib/tools/form';

	let {
		testCases = $bindable(),
		spec,
		script,
		entryFunction,
		manifest,
		outputKeys,
		declaredConstants,
	}: {
		testCases: ToolTestCases;
		spec: ToolFormSpec;
		script: string;
		entryFunction: string;
		manifest: ToolManifest;
		outputKeys: string[];
		declaredConstants: string[];
	} = $props();

	let openIndex = $state<number | null>(null);
	let runs = $state<Record<number, CaseRun>>({});
	let runningIndex = $state<number | null>(null);
	let runningAll = $state(false);
	// Bumped when a case is replaced from outside its editor, so the editor reseeds its buffers.
	let editorSeed = $state(0);

	const cases = $derived(testCases.cases ?? []);
	const tolerance = $derived(testCases.tolerance ?? DEFAULT_TOLERANCE);
	const runnable = $derived(script.trim() !== '');

	function setCases(next: ToolTestCase[]) {
		testCases = { ...testCases, cases: next };
	}

	function addCase() {
		const next = [...cases, { name: `Case ${cases.length + 1}`, inputs: {}, expected: {} }];
		setCases(next);
		openIndex = next.length - 1;
		editorSeed++;
	}

	function removeCase(i: number) {
		setCases(cases.filter((_, idx) => idx !== i));
		runs = {};
		openIndex = null;
		editorSeed++;
	}

	function setTolerance(text: string) {
		const n = Number(text);
		testCases = {
			...testCases,
			...(text.trim() !== '' && Number.isFinite(n) ? { tolerance: n } : { tolerance: undefined }),
		};
	}

	const runCase = (i: number): Promise<CaseRun> =>
		runTestCase({ script, entryFunction, manifest, testCase: cases[i], tolerance });

	async function runOne(i: number) {
		runningIndex = i;
		try {
			runs = { ...runs, [i]: await runCase(i) };
		} finally {
			runningIndex = null;
		}
	}

	async function runAll() {
		runningAll = true;
		const next: Record<number, CaseRun> = {};
		try {
			for (let i = 0; i < cases.length; i++) next[i] = await runCase(i);
			runs = next;
		} finally {
			runningAll = false;
		}
	}

	function adoptResults(i: number) {
		const results = runs[i]?.results;
		if (!results) return;
		const expected = Object.fromEntries(
			Object.entries(results).filter(([, v]) => v !== null && v !== undefined),
		);
		setCases(cases.map((c, idx) => (idx === i ? { ...c, expected } : c)));
		editorSeed++;
	}

	const summary = $derived.by(() => {
		const entries = Object.values(runs);
		if (entries.length === 0) return null;
		return { total: entries.length, failed: entries.filter((r) => !r.passed).length };
	});

	function inputsSummary(testCase: ToolTestCase): string {
		const keys = Object.keys(testCase.inputs ?? {});
		const curves = Object.keys(testCase.curves ?? {});
		const parts = [...keys, ...curves.map((c) => `${c} (curve)`)];
		if (parts.length === 0) return 'No inputs';
		return parts.length > 4 ? `${parts.slice(0, 4).join(', ')} +${parts.length - 4}` : parts.join(', ');
	}

	function expectedSummary(testCase: ToolTestCase): string {
		const keys = Object.keys(testCase.expected ?? {});
		const absent = testCase.absent ?? [];
		const parts = [...keys, ...absent.map((k) => `${k} absent`)];
		if (parts.length === 0) return 'Nothing checked';
		return parts.length > 4 ? `${parts.slice(0, 4).join(', ')} +${parts.length - 4}` : parts.join(', ');
	}
</script>

<div class="rounded-md border border-brand-divider">
	<div class="flex flex-wrap items-end justify-between gap-2 px-3 py-2 border-b border-brand-divider">
		<div>
			<h5 class="text-sm font-semibold">Test cases</h5>
			{#if summary}
				<p class="text-xs text-brand-muted">
					Last run: {summary.total - summary.failed} of {summary.total} passing.
				</p>
			{/if}
		</div>
		<div class="flex items-end gap-2">
			<div class="flex flex-col gap-1">
				<label for="tm-tolerance" class="text-xs font-medium">Tolerance</label>
				<input
					id="tm-tolerance"
					type="text"
					value={testCases.tolerance ?? ''}
					oninput={(e) => setTolerance(e.currentTarget.value)}
					placeholder={String(DEFAULT_TOLERANCE)}
					class="w-28 px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs font-mono"
				/>
			</div>
			<Button size="sm" onclick={runAll} disabled={runningAll || !runnable || cases.length === 0}>
				{runningAll ? 'Running…' : 'Run all cases'}
			</Button>
			<Button variant="primary" size="sm" onclick={addCase}>Add case</Button>
		</div>
	</div>

	{#if !runnable}
		<p class="px-3 py-2 text-xs text-brand-muted">No script to run these against.</p>
	{/if}

	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="bg-brand-bg border-b border-brand-divider text-left text-xs">
					<th class="px-3 py-2 font-semibold">Case</th>
					<th class="px-3 py-2 font-semibold">Inputs</th>
					<th class="px-3 py-2 font-semibold">Expected</th>
					<th class="px-3 py-2 font-semibold">Result</th>
					<th class="px-3 py-2"></th>
				</tr>
			</thead>
			<tbody>
				{#each cases as testCase, i (i)}
					{@const run = runs[i] ?? null}
					<tr class="border-b border-brand-divider {openIndex === i ? 'bg-brand-primary/5' : ''}">
						<td class="px-3 py-2">
							<button
								onclick={() => (openIndex = openIndex === i ? null : i)}
								class="text-brand-primary bg-transparent border-none cursor-pointer hover:underline font-medium text-left"
							>{testCase.name || `Case ${i + 1}`}</button>
						</td>
						<td class="px-3 py-2 text-xs font-mono text-brand-muted">{inputsSummary(testCase)}</td>
						<td class="px-3 py-2 text-xs font-mono text-brand-muted">{expectedSummary(testCase)}</td>
						<td class="px-3 py-2 text-xs">
							{#if run?.failure}
								<Badge variant="alarm">errored</Badge>
							{:else if run}
								<Badge variant={run.passed ? 'ok' : 'alarm'}>{run.passed ? 'passed' : 'failed'}</Badge>
							{:else}
								<span class="text-brand-muted">Not run</span>
							{/if}
						</td>
						<td class="px-3 py-2 text-right whitespace-nowrap">
							<Button size="sm" onclick={() => runOne(i)} disabled={runningIndex === i || !runnable}>
								{runningIndex === i ? 'Running…' : 'Run'}
							</Button>
							<Button variant="danger" size="sm" onclick={() => removeCase(i)}>Remove</Button>
						</td>
					</tr>
					{#if openIndex === i}
						<tr>
							<td colspan="5" class="p-0">
								{#key editorSeed}
									<TestCaseEditor
										{testCase}
										{spec}
										index={i}
										{outputKeys}
										{declaredConstants}
										lastRun={run}
										running={runningIndex === i}
										onRun={() => runOne(i)}
										onAdopt={() => adoptResults(i)}
									/>
								{/key}
							</td>
						</tr>
					{:else if run}
						<tr>
							<td colspan="5" class="px-3 py-2 bg-brand-bg/40">
								<CaseResultTable rows={run.rows} failure={run.failure} empty="This case names nothing to check." />
							</td>
						</tr>
					{/if}
				{/each}
				{#if cases.length === 0}
					<tr>
						<td colspan="5" class="px-3 py-6 text-center text-sm text-brand-muted">
							No cases.
						</td>
					</tr>
				{/if}
			</tbody>
		</table>
	</div>
</div>
