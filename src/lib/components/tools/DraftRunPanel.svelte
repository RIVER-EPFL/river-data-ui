<script lang="ts">
	// The manifest under construction, rendered as the form it produces, and run as it stands.
	//
	// The form is the same component the Tools page renders, so what an author sees here is what
	// an operator will meet. The run goes through `POST /tool_scripts/draft_run`, which applies
	// the same manifest validation, constant resolution and curve resolution as a saved tool.
	import { untrack } from 'svelte';
	import {
		draftRunToolScript,
		type ToolDraftRunResponse,
		type ToolLintFinding,
		type ToolManifest,
		type ToolTestCase,
	} from '$api/service';
	import Button from '$components/ui/Button.svelte';
	import ToolForm from '$components/tools/ToolForm.svelte';
	import ToolRunError from '$components/tools/ToolRunError.svelte';
	import { formatValue, toolRunFailure, type ToolRunFailure } from '$lib/tools/draft';
	import {
		buildRequestBody,
		emptyCurveSelections,
		initFormState,
		reseedFormState,
		type FormState,
		type ToolFormSpec,
	} from '$lib/tools/form';
	import type { CurveSelection } from '$components/tools/CurvePicker.svelte';

	let {
		spec,
		script,
		entryFunction,
		manifest,
		caseCount,
		onSaveAsCase,
		onRun = null,
		runState = $bindable('idle'),
		runLint = $bindable([]),
	}: {
		spec: ToolFormSpec;
		script: string;
		entryFunction: string;
		manifest: ToolManifest;
		/** Only for the name a saved run starts with. */
		caseCount: number;
		onSaveAsCase: (testCase: ToolTestCase) => void;
		/** Fired as a run starts, so a host holding this panel folded can open it. */
		onRun?: (() => void) | null;
		runState?: 'idle' | 'ok' | 'failed';
		/** The safety-lint findings of the last run; the server refuses a version carrying any. */
		runLint?: ToolLintFinding[];
	} = $props();

	// Seeded from the manifest as it stands; kept in step with it by the effect below rather than
	// by re-reading the prop, so what is typed survives an edit to the manifest.
	let form = $state<FormState>(untrack(() => initFormState(spec)));
	let curveSelections = $state<Record<string, CurveSelection>>(
		untrack(() => emptyCurveSelections(spec)),
	);
	let running = $state(false);
	let run = $state<ToolDraftRunResponse | null>(null);
	let failure = $state<ToolRunFailure | null>(null);
	let bodyUsed = $state<Record<string, unknown> | null>(null);
	let buildError = $state('');
	let caseName = $state('');

	// The params and curve slots as the form cares about them. A relabelled param does not
	// disturb what is typed; a renamed or retyped one does.
	const signature = $derived(
		spec.params.map((p) => `${p.name}:${p.kind}`).join('|') +
			'#' +
			spec.curves.map((c) => c.name).join('|'),
	);
	let lastSignature = untrack(() => signature);

	$effect(() => {
		const sig = signature;
		if (sig === lastSignature) return;
		lastSignature = sig;
		untrack(() => {
			form = reseedFormState(spec, form);
			const next = emptyCurveSelections(spec);
			for (const name of Object.keys(next)) {
				if (curveSelections[name]) next[name] = curveSelections[name];
			}
			curveSelections = next;
		});
	});

	async function doRun() {
		const built = buildRequestBody(spec, form, curveSelections);
		if ('error' in built) {
			buildError = built.error;
			return;
		}
		buildError = '';
		onRun?.();
		running = true;
		run = null;
		failure = null;
		try {
			const res = await draftRunToolScript({
				script,
				entry_function: entryFunction.trim() || 'tool',
				manifest,
				inputs: built.body,
			});
			// A refused body, a raised script and an unreachable runner all resolve now, carrying the
			// lint findings with them; the catch is left for a 400 (an unreadable manifest, which has
			// no findings to report) and for transport errors.
			run = res;
			failure = res.failure ?? null;
			bodyUsed = built.body;
			caseName = `Case ${caseCount + 1}`;
			runLint = res.lint ?? [];
			runState = res.ran && !res.failure ? 'ok' : 'failed';
		} catch (e) {
			failure = toolRunFailure(e);
			runState = 'failed';
		} finally {
			running = false;
		}
	}

	// The run fields are absent unless the script ran, so each one is read through its empty value.
	const results = $derived(Object.entries(run?.results ?? {}));
	const inputsUsed = $derived(run?.inputs_used ?? []);
	const inputsIgnored = $derived(run?.inputs_ignored ?? []);
	const constantsResolved = $derived(run?.constants ?? {});
	const curvesResolved = $derived(run?.curves ?? []);

	/** What the run produced, as a case that reruns without the form or the catalog. */
	function saveAsCase() {
		if (!run?.ran || !run.results || !bodyUsed) return;
		const curveNames = new Set(spec.curves.map((c) => c.name));
		const inputs = Object.fromEntries(
			Object.entries(bodyUsed).filter(([k]) => !curveNames.has(k)),
		);
		// Coefficients rather than a stored-curve reference: a case that reads a curve row is only
		// reproducible for as long as that row says what it said today.
		const curves = Object.fromEntries(
			(run.curves ?? []).map((c) => [
				c.name,
				{ slope: c.curve.slope, intercept: c.curve.intercept },
			]),
		);
		const constants = run.constants ?? {};
		const expected = Object.fromEntries(
			Object.entries(run.results).filter(([, v]) => v !== null && v !== undefined),
		);
		onSaveAsCase({
			name: caseName.trim() || `Case ${caseCount + 1}`,
			inputs,
			...(Object.keys(curves).length > 0 ? { curves } : {}),
			expected,
			...(Object.keys(constants).length > 0 ? { constants } : {}),
		});
	}
</script>

<div class="p-3 space-y-3">
	<ToolForm {spec} bind:form bind:curveSelections idPrefix="tm-preview" />

	{#if buildError}
		<p class="text-xs text-severity-alarm">{buildError}</p>
	{/if}

	<Button variant="primary" size="sm" onclick={doRun} disabled={running || !script.trim()}>
		{running ? 'Running…' : 'Run'}
	</Button>
	{#if failure}
		<ToolRunError {failure} />
	{/if}

	{#if run?.ran}
		<div class="space-y-2">
			<div class="flex items-baseline justify-between gap-2">
				<h5 class="text-sm font-semibold">Results</h5>
				{#if run.tool_version.r_version}
					<span class="text-xs text-brand-muted">R {run.tool_version.r_version}</span>
				{/if}
			</div>

			{#if results.length > 0}
				<div class="overflow-x-auto">
					<table class="w-full text-xs">
						<tbody>
							{#each results as [key, value] (key)}
								<tr class="border-b border-brand-divider last:border-b-0">
									<td class="px-2 py-1 font-mono text-brand-muted">{key}</td>
									<td class="px-2 py-1 font-mono text-right">{formatValue(value)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="text-xs text-brand-muted">The script returned no outputs.</p>
			{/if}

			<div class="flex flex-wrap items-end gap-2">
				<div class="flex flex-col gap-1">
					<label for="tm-case-name" class="text-xs font-medium">Case name</label>
					<input
						id="tm-case-name"
						type="text"
						bind:value={caseName}
						class="px-2 py-1 border border-brand-divider rounded-md bg-brand-surface text-xs"
					/>
				</div>
				<Button size="sm" onclick={saveAsCase}>Save this run as a test case</Button>
			</div>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
				<div>
					<p class="font-medium">Inputs used</p>
					{#if inputsUsed.length > 0}
						<p class="font-mono text-brand-muted break-words">{inputsUsed.join(', ')}</p>
					{:else}
						<p class="text-brand-muted">None</p>
					{/if}
				</div>
				<div>
					<p class="font-medium">Inputs ignored</p>
					{#if inputsIgnored.length > 0}
						<p class="font-mono text-severity-warning-text bg-severity-warning-soft border border-severity-warning-border rounded px-1.5 py-0.5 break-words">
							{inputsIgnored.join(', ')}
						</p>
					{:else}
						<p class="text-brand-muted">None</p>
					{/if}
				</div>
				<div>
					<p class="font-medium">Constants resolved</p>
					{#if Object.keys(constantsResolved).length > 0}
						{#each Object.entries(constantsResolved) as [name, value] (name)}
							<p class="font-mono text-brand-muted">{name} = {value}</p>
						{/each}
					{:else}
						<p class="text-brand-muted">None declared</p>
					{/if}
				</div>
				<div>
					<p class="font-medium">Curves resolved</p>
					{#if curvesResolved.length > 0}
						{#each curvesResolved as c (c.name)}
							<p class="font-mono text-brand-muted">
								{c.name}: slope {c.curve.slope}, intercept {c.curve.intercept}
							</p>
						{/each}
					{:else}
						<p class="text-brand-muted">None declared</p>
					{/if}
				</div>
			</div>
		</div>
	{/if}

	<!-- Outside the results block: the findings are about the draft, so a run that raised is
	     exactly when an author needs to see them. -->
	{#if run && run.lint.length > 0}
		<div class="rounded-md border border-severity-alarm/40 bg-severity-alarm-soft p-2 space-y-0.5">
			<p class="text-xs font-medium text-severity-alarm">
				Saving a version with these findings is refused:
			</p>
			{#each run.lint as f (f.line + f.message)}
				<p class="text-xs font-mono">line {f.line}: {f.message}</p>
			{/each}
		</div>
	{/if}
</div>
