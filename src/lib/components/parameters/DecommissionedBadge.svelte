<script lang="ts">
	import { base } from '$app/paths';
	import type { DecommissionedBy } from '$api/crud';
	import { formatDate } from '$lib/utils';
	import { toolboxHref } from '$lib/toolbox/route';

	// A parameter only a decommissioned calculation published (Q299): nothing computes it now, and
	// the badge opens the calculation it was computed by.
	let { by }: { by: DecommissionedBy } = $props();
</script>

<a
	href={toolboxHref(base, by.tool_script_id)}
	title="Computed by {by.calculation}, decommissioned on {formatDate(by.at)}. Nothing computes this parameter now."
	class="ml-1.5 rounded-full bg-brand-bg px-1.5 py-0.5 align-middle text-[10px] font-medium text-brand-muted no-underline hover:underline"
	>decommissioned</a
>
