<script lang="ts">
	import { page } from '$app/state';
	import TokenForm from '$components/tokens/TokenForm.svelte';
</script>

<TokenForm mode="edit" tokenId={page.params.id!} />
