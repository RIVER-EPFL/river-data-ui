<script lang="ts">
	// A failure raised inside the R script. The message, the call it was raised from and the
	// traceback are separate fields on the wire, so they stay separate here: the call is what an
	// author reads first, and the traceback is only worth the space when it is asked for.
	import type { ToolRunFailure } from '$lib/tools/draft';

	let { failure }: { failure: ToolRunFailure } = $props();
</script>

<div class="rounded-md border border-severity-alarm/40 bg-severity-alarm-soft p-2.5 space-y-1">
	<!-- Printed the way R prints a condition: "Error in <call> : <message>" -->
	<p class="text-xs font-mono break-words text-severity-alarm">
		{#if failure.call}Error in {failure.call} : {:else}Error: {/if}<span class="text-brand-text"
			>{failure.message}</span
		>
	</p>
	{#if failure.traceback.length > 0}
		<details>
			<summary class="text-xs cursor-pointer text-brand-muted">
				Traceback ({failure.traceback.length} frames)
			</summary>
			<ol class="mt-1 space-y-0.5">
				{#each failure.traceback as frame, i}
					<li class="text-xs font-mono text-brand-muted">
						<span class="mr-1">{i + 1}.</span>{frame}
					</li>
				{/each}
			</ol>
		</details>
	{/if}
</div>
