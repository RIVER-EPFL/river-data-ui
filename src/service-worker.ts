/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

self.addEventListener('push', (event) => {
	if (!event.data) return;
	const data = event.data.json();
	const options: NotificationOptions = {
		body: data.body ?? '',
		tag: data.tag ?? 'river-data',
		data: { url: data.url },
	};
	event.waitUntil(self.registration.showNotification(data.title ?? 'RIVER Data', options));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url: string = event.notification.data?.url ?? '/admin/';
	event.waitUntil(
		self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
			for (const client of clients) {
				if (new URL(client.url).pathname.startsWith('/admin') && 'focus' in client) {
					client.focus();
					client.navigate(url);
					return;
				}
			}
			return self.clients.openWindow(url);
		})
	);
});
