<script lang="ts">
	import {
		NOTIFICATION_GROUPS,
		type NotificationGroupId,
	} from '$lib/notifications/groups';
	import type { Snippet } from 'svelte';

	// What a person actually chooses between: the alarms their sites raise, and the alerts about
	// the plumbing that carries them. The site tree scopes the alarm group and sits under it.

	let {
		subscribed = $bindable(),
		scopes,
	}: {
		subscribed: Record<NotificationGroupId, boolean>;
		scopes?: Snippet<[NotificationGroupId]>;
	} = $props();
</script>

<div class="space-y-3">
	{#each NOTIFICATION_GROUPS as group (group.id)}
		<div>
			<label class="flex items-start gap-2 font-medium text-brand-text">
				<input
					type="checkbox"
					class="w-4 h-4 mt-0.5"
					checked={subscribed[group.id]}
					onchange={(e) => (subscribed = { ...subscribed, [group.id]: e.currentTarget.checked })}
				/>
				<span>
					{group.label}
					<span class="block text-sm font-normal text-brand-text-muted">
						{group.description}
						{group.subscribedWithoutARow ? 'On unless you turn it off.' : 'Off unless you turn it on.'}
					</span>
				</span>
			</label>
			{#if subscribed[group.id] && scopes}
				<div class="ml-6 mt-2">
					{@render scopes(group.id)}
				</div>
			{/if}
		</div>
	{/each}
</div>
