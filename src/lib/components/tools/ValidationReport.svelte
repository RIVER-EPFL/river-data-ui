<script lang="ts">
	// The record of one validation run: what went in, what came out, and whether it matched.
	//
	// The validate endpoint reports pass or fail per case and the mismatching keys of a failing one,
	// so the values a passing case produced are not in that response. They are recovered by running
	// each stored case through the draft-run endpoint, which is the same runner and the same
	// comparison; the pass or fail shown is always the server's.
	import type { ToolParam, ToolTestCase, ToolValidateResponse } from '$api/service';
	import Badge from '$components/ui/Badge.svelte';
	import Button from '$components/ui/Button.svelte';
	import CaseResultTable from '$components/tools/CaseResultTable.svelte';
	import { toastStore } from '$lib/stores/toast.svelte';
	import { formatDateTime } from '$lib/utils';
	import { DEFAULT_TOLERANCE, formatValue, rowsFromFailures, type CaseRun } from '$lib/tools/draft';

	let {
		validation,
		cases,
		params,
		tolerance = DEFAULT_TOLERANCE,
		toolName,
		versionNo = null,
		runs = {},
		rerunning = false,
	}: {
		validation: ToolValidateResponse;
		cases: ToolTestCase[];
		params: ToolParam[];
		tolerance?: number;
		toolName: string;
		versionNo?: number | null;
		/** Actual values per case name, from replaying each case against the runner. */
		runs?: Record<string, CaseRun>;
		rerunning?: boolean;
	} = $props();

	const labelOf = (name: string) => params.find((p) => p.name === name)?.label ?? name;

	const passedCount = $derived(validation.cases.filter((c) => c.passed).length);

	function caseByName(name: string): ToolTestCase | null {
		return cases.find((c, i) => (c.name || `Case ${i + 1}`) === name) ?? null;
	}

	/** One input as a row: scalars inline, grids and arrays as their JSON, which is how they are entered. */
	function inputRows(testCase: ToolTestCase | null): { label: string; key: string; value: string }[] {
		if (!testCase) return [];
		const rows: { label: string; key: string; value: string }[] = [];
		for (const [key, value] of Object.entries(testCase.inputs ?? {}))
			rows.push({ label: labelOf(key), key, value: formatValue(value) });
		for (const [key, value] of Object.entries(testCase.curves ?? {}))
			rows.push({ label: `${key} (curve)`, key, value: formatValue(value) });
		for (const [key, value] of Object.entries(testCase.constants ?? {}))
			rows.push({ label: `${key} (constant)`, key, value: formatValue(value) });
		return rows;
	}

	/** Expected against actual for every checked key, passing cases included. */
	function outputRows(name: string) {
		const run = runs[name];
		if (run && run.rows.length > 0) return run.rows;
		const result = validation.cases.find((c) => c.name === name);
		return rowsFromFailures(result?.failures ?? []);
	}

	function reportText(): string {
		const lines: string[] = [];
		lines.push(`Tool: ${toolName}${versionNo != null ? `, version ${versionNo}` : ''}`);
		lines.push(`Validation: ${validation.passed ? 'passed' : 'failed'}`);
		lines.push(`Cases: ${passedCount} of ${validation.cases.length} passed`);
		if (validation.validated_at) lines.push(`Run at: ${formatDateTime(validation.validated_at)}`);
		lines.push(`Tolerance: ${tolerance}`);
		for (const c of validation.cases) {
			lines.push('');
			lines.push(`Case: ${c.name} (${c.passed ? 'passed' : 'failed'})`);
			const inputs = inputRows(caseByName(c.name));
			lines.push('  Inputs:');
			if (inputs.length === 0) lines.push('    none');
			for (const r of inputs) lines.push(`    ${r.key} = ${r.value}`);
			lines.push('  Outputs (expected, actual, difference):');
			const rows = outputRows(c.name);
			if (rows.length === 0) lines.push('    none recorded');
			for (const r of rows)
				lines.push(
					`    ${r.key}: ${r.expected}, ${r.got}${r.difference ? `, ${r.difference}` : ''}${r.passed ? '' : '  MISMATCH'}`,
				);
			const run = runs[c.name];
			if (run?.failure) {
				lines.push(`  Error: ${run.failure.message}`);
				if (run.failure.call) lines.push(`  Call: ${run.failure.call}`);
				for (const t of run.failure.traceback) lines.push(`    ${t}`);
			} else if (c.error) {
				lines.push(`  Error: ${c.error}`);
			}
		}
		return lines.join('\n');
	}

	async function copyReport() {
		try {
			await navigator.clipboard.writeText(reportText());
			toastStore.success('Report copied');
		} catch {
			toastStore.error('The browser refused clipboard access');
		}
	}
</script>

<div class="validation-report rounded-md border border-brand-divider">
	<div class="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-brand-divider">
		<Badge variant={validation.passed ? 'ok' : 'alarm'}>
			{validation.passed ? 'Validation passed' : 'Validation failed'}
		</Badge>
		<span class="text-xs text-brand-muted">
			{passedCount} of {validation.cases.length} cases
			{#if versionNo != null}· Version {versionNo}{/if}
			{#if validation.validated_at}· {formatDateTime(validation.validated_at)}{/if}
			· tolerance {tolerance}
			{#if rerunning}· reading values…{/if}
		</span>
		<span class="grow"></span>
		<div class="no-print flex items-center gap-1">
			<Button size="sm" onclick={copyReport}>Copy report</Button>
			<Button size="sm" onclick={() => window.print()}>Print</Button>
		</div>
	</div>

	<div class="divide-y divide-brand-divider">
		{#each validation.cases as c (c.name)}
			{@const inputs = inputRows(caseByName(c.name))}
			{@const rows = outputRows(c.name)}
			{@const run = runs[c.name] ?? null}
			<div class="px-3 py-2 space-y-2">
				<div class="flex items-center gap-2">
					<Badge variant={c.passed ? 'ok' : 'alarm'}>{c.passed ? 'pass' : 'fail'}</Badge>
					<span class="text-sm font-medium">{c.name}</span>
				</div>

				<div class="grid grid-cols-1 lg:grid-cols-2 gap-3">
					<div>
						<h6 class="text-xs font-semibold mb-1">Inputs</h6>
						{#if inputs.length === 0}
							<p class="text-xs text-brand-muted">None.</p>
						{:else}
							<div class="overflow-x-auto">
								<table class="w-full text-xs">
									<tbody>
										{#each inputs as r (r.key)}
											<tr class="border-b border-brand-divider last:border-b-0">
												<td class="px-1 py-0.5 align-top">
													{r.label}
													<span class="font-mono text-brand-muted">{r.key}</span>
												</td>
												<td class="px-1 py-0.5 align-top font-mono break-all">{r.value}</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</div>

					<div>
						<h6 class="text-xs font-semibold mb-1">Outputs</h6>
						<CaseResultTable
							{rows}
							failure={run?.failure ??
								(c.error ? { message: c.error, call: null, traceback: [] } : null)}
							empty="Nothing recorded."
						/>
					</div>
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	/* The one printable thing on this page: the app shell and every other section are hidden so a
	   validation record prints on its own. */
	@media print {
		:global(body *) {
			visibility: hidden;
		}
		.validation-report,
		.validation-report * {
			visibility: visible;
		}
		.validation-report {
			position: absolute;
			left: 0;
			top: 0;
			width: 100%;
			border: none;
		}
		.no-print {
			display: none;
		}
	}
</style>
