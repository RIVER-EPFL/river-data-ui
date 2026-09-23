<script lang="ts">
	import { updateToolScript } from '$api/service';
	import { apiMessage } from '$lib/standardCurves';
	import { toastStore } from '$lib/stores/toast.svelte';

	let {
		id,
		enabled,
		onchanged,
	}: {
		id: string;
		enabled: boolean;
		onchanged?: (enabled: boolean) => void | Promise<void>;
	} = $props();

	let saving = $state(false);

	async function set(next: boolean) {
		saving = true;
		try {
			await updateToolScript(id, { enabled: next });
			toastStore.success(next ? 'Calculation switched on' : 'Calculation switched off');
			await onchanged?.(next);
		} catch (e) {
			toastStore.error(apiMessage(e));
		} finally {
			saving = false;
		}
	}
</script>

<label
	class="inline-flex items-center gap-1 text-xs"
	title="On: fires wherever its inputs land, is audited and listed. Off: kept with its versions, fires nowhere."
>
	<input
		type="checkbox"
		checked={enabled}
		disabled={saving}
		onchange={(e) => set((e.currentTarget as HTMLInputElement).checked)}
	/>
	Fires
</label>
