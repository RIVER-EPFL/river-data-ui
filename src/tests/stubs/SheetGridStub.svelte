<script lang="ts">
	let { data }: { data: unknown[][] } = $props();
</script>

<table>
	<tbody>
		{#each data as row}
			<tr>
				{#each row as value}
					<td>{value == null ? '' : String(value)}</td>
				{/each}
			</tr>
		{/each}
	</tbody>
</table>
