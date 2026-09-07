<script lang="ts">
	import { base } from '$app/paths';
	import type { PairingPlan } from '$api/service';
	import Button from '$components/ui/Button.svelte';
	import { formatCount } from '$lib/format';

	// The wizard's Confirm step: what the apply will do, counted from the plan the reviewer just
	// worked, and the one button that does it.
	let {
		plan,
		summary,
		reviewProgress,
		familySummary,
		planDeviceCount,
		openInstrumentQuestions,
		undeclaredEstimatorCount,
		undeclaredEstimatorFamilies,
		applying,
		applyJobId,
		applyStatus,
		onback,
		onapply,
		ongotoparam,
		ongotoinstruments,
		ongotosites,
	}: {
		plan: PairingPlan;
		/** What the apply will pair, skip and create, counted over every entry. */
		summary: {
			toPair: number;
			toSkip: number;
			total: number;
			warnings: number;
			newSites: number;
			newParams: number;
			newProjects: number;
		};
		/** How far the review got, over the entries that will pair. */
		reviewProgress: {
			total: number;
			needs_checking: number;
			self_validated: number;
			acknowledged: number;
			needsCheckingPct: number;
			selfValidatedPct: number;
		};
		familySummary: { streams: number; columns: number };
		planDeviceCount: number;
		openInstrumentQuestions: number;
		/** Parameters whose divisor nobody declared; the apply leaves them undeclared. */
		undeclaredEstimatorCount: number;
		undeclaredEstimatorFamilies: Array<{ paramName: string; sdColumn: string; sites: number }>;
		applying: boolean;
		/** The tracked job the apply runs as, once it has one. */
		applyJobId: string | null;
		applyStatus: string;
		onback: () => void;
		onapply: () => void;
		ongotoparam: (paramName: string) => void;
		ongotoinstruments: () => void;
		/** Back to the Sites tab under one review filter, at its first page. */
		ongotosites: (filter: 'needs_checking' | 'self_validated') => void;
	} = $props();
</script>

<div class="space-y-4 max-w-xl mx-auto">
	<div class="flex items-center gap-3">
		<Button variant="ghost" size="sm" onclick={() => onback()} class="text-brand-primary">&larr; Back to review</Button>
		<h2 class="text-xl font-semibold">Confirm Plan</h2>
	</div>

	{#if openInstrumentQuestions > 0}
		<div class="rounded-md border border-severity-warning-border bg-severity-warning-soft p-3 text-sm text-severity-warning-text space-y-2">
			<div class="font-semibold">
				{openInstrumentQuestions} instrument{openInstrumentQuestions === 1 ? '' : 's'} still to decide
			</div>
			<p class="text-xs opacity-90">Apply refuses a plan holding a proposal nobody agreed to.</p>
			<Button size="sm" onclick={ongotoinstruments}>
				Open Instruments
			</Button>
		</div>
	{/if}

	<div class="rounded-md border border-brand-divider bg-brand-surface p-6 space-y-4">
		<p class="text-sm">Applying this plan will:</p>
		<div class="grid grid-cols-2 gap-3 text-sm">
			<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Pair streams</span><span class="text-lg font-semibold text-severity-ok">{formatCount(summary.toPair)}</span></div>
			<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Skip streams</span><span class="text-lg font-semibold">{formatCount(summary.toSkip)}</span></div>
			<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Create projects</span><span class="text-lg font-semibold">{summary.newProjects}</span></div>
			<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Create sites</span><span class="text-lg font-semibold">{summary.newSites}</span></div>
			<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Create parameters</span><span class="text-lg font-semibold">{summary.newParams}</span></div>
			<div class="p-3 bg-brand-bg rounded"><span class="text-brand-muted block text-xs">Create instruments</span><span class="text-lg font-semibold">{plan.summary.instruments_to_create}</span></div>
			{#if planDeviceCount > 0}
				<div class="p-3 bg-brand-bg rounded" title="Each device is attached to its feeds and deployed at its site, one deployment per parameter it serves">
					<span class="text-brand-muted block text-xs">Attach devices</span>
					<span class="text-lg font-semibold">{planDeviceCount}</span>
				</div>
			{/if}
			{#if summary.warnings > 0}
				<div class="p-3 bg-severity-warning-soft rounded"><span class="text-severity-warning block text-xs">Warnings</span><span class="text-lg font-semibold text-severity-warning">{summary.warnings}</span></div>
			{/if}
		</div>

		{#if familySummary.streams > 0}
			<p class="text-xs text-brand-muted">
				{familySummary.streams} of these streams are replicate families ({familySummary.columns}
				readings columns collapse into them). Replicates are stored per instant at indices
				0..n-1; the source's averages and standard deviations are audited, not stored.
			</p>
		{/if}
		{#if undeclaredEstimatorFamilies.length > 0}
			<div class="px-3 py-2 rounded-md bg-severity-warning-soft border border-severity-warning-border text-xs text-severity-warning-text space-y-1">
				<p>
					{undeclaredEstimatorCount} replicate famil{undeclaredEstimatorCount === 1 ? 'y' : 'ies'}
					will be paired undeclared: their statistics use sample (n-1) meanwhile, and every
					disagreement the population divisor (n) explains is held in the audit queue until you
					declare one.
				</p>
				<ul class="space-y-0.5">
					{#each undeclaredEstimatorFamilies.slice(0, 6) as fam (fam.paramName)}
						<li>
							<button
								onclick={() => { onback(); ongotoparam(fam.paramName); }}
								class="bg-transparent border-none p-0 cursor-pointer font-semibold underline-offset-2 hover:underline text-severity-warning-text"
							>{fam.paramName}</button>
							<span class="text-brand-muted">
								(source ships {fam.sdColumn}, {fam.sites} site{fam.sites === 1 ? '' : 's'})
							</span>
						</li>
					{/each}
					{#if undeclaredEstimatorFamilies.length > 6}
						<li class="text-brand-muted">and {undeclaredEstimatorFamilies.length - 6} more</li>
					{/if}
				</ul>
				<p class="text-brand-muted">Set the divisor in Review now, or leave it and decide from the audit queue.</p>
			</div>
		{/if}
		<p class="text-xs text-brand-muted">Readings will be backfilled with site and parameter IDs. Continuous aggregates will refresh in the background. This operation can be reverted.</p>

		<!-- What share of the plan has been looked at, beside the button that applies it. Each
		     number opens the review filtered to exactly the entries it counts. -->
		<div class="flex flex-wrap items-center gap-2 pt-1 text-xs">
			<button
				onclick={() => ongotosites('needs_checking')}
				title="Entries that did not resolve, or that carry a warning, and nobody has ticked"
				class="px-2 py-1 rounded cursor-pointer border-none bg-severity-warning-soft text-severity-warning-text"
			>{reviewProgress.needsCheckingPct}% need checking ({formatCount(reviewProgress.needs_checking)})</button>
			<button
				onclick={() => ongotosites('self_validated')}
				title="Everything resolved and nothing warned, so these wait on nobody. Worth looking over all the same."
				class="px-2 py-1 rounded cursor-pointer border-none bg-brand-bg text-brand-muted hover:text-brand-text"
			>{reviewProgress.selfValidatedPct}% self-validated ({formatCount(reviewProgress.self_validated)})</button>
			{#if reviewProgress.acknowledged > 0}
				<span class="px-2 py-1 rounded bg-severity-ok-soft text-severity-ok"
				>{formatCount(reviewProgress.acknowledged)} checked by hand</span>
			{/if}
		</div>

		{#if applying && applyJobId}
			<p class="text-xs text-brand-muted">
				Running as job <span class="font-mono">{applyJobId.slice(0, 8)}</span>, which carries on if
				you leave this page: follow it on
				<a href="{base}/system?tab=jobs" class="text-brand-primary no-underline hover:underline">System → Jobs</a>.
			</p>
		{/if}

		<div class="flex gap-3 pt-2">
			<Button onclick={() => onback()} class="px-4 py-2">Back to Review</Button>
			<Button variant="primary" onclick={onapply} disabled={applying} class="px-4 py-2 font-semibold">
				{applying ? applyStatus || 'Applying…' : 'Apply Plan'}
			</Button>
		</div>
	</div>
</div>
