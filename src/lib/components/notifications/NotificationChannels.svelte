<script lang="ts">
	import type { NotificationChannelView } from '$api/service';
	import { SITE_SCOPED_CHANNELS, frequencyPreview } from '$lib/notifications/channels';
	import type { Snippet } from 'svelte';

	// One row per channel, each with what it sends and how often it has sent it lately, so the
	// volume is known before the box is ticked. The site tree scopes the alarm channels.

	let {
		channels,
		subscribed = $bindable(),
		scopes,
	}: {
		channels: NotificationChannelView[];
		subscribed: Record<string, boolean>;
		scopes?: Snippet<[string]>;
	} = $props();
</script>

<div class="space-y-3">
	{#each channels as channel (channel.kind)}
		{@const on = subscribed[channel.kind] ?? channel.onByDefault}
		<div>
			<label class="flex items-start gap-2 font-medium text-brand-text">
				<input
					type="checkbox"
					class="w-4 h-4 mt-0.5"
					checked={on}
					onchange={(e) =>
						(subscribed = { ...subscribed, [channel.kind]: e.currentTarget.checked })}
				/>
				<span>
					{channel.label}
					<span class="block text-sm font-normal text-brand-text-muted">
						{channel.description}
						{channel.onByDefault ? 'On unless you turn it off.' : 'Off unless you turn it on.'}
					</span>
					<span class="block text-sm font-normal text-brand-text-muted">
						{frequencyPreview(channel)}
					</span>
				</span>
			</label>
			{#if on && scopes && SITE_SCOPED_CHANNELS.includes(channel.kind)}
				<div class="ml-6 mt-2">
					{@render scopes(channel.kind)}
				</div>
			{/if}
		</div>
	{/each}
</div>
