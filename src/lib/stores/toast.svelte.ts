export interface Toast {
	id: number;
	message: string;
	type: 'success' | 'error' | 'info';
}

let counter = 0;
let toasts = $state<Toast[]>([]);

export const toastStore = {
	get items() {
		return toasts;
	},
	success(message: string) {
		add(message, 'success');
	},
	error(message: string) {
		add(message, 'error');
	},
	info(message: string) {
		add(message, 'info');
	},
	dismiss(id: number) {
		toasts = toasts.filter((t) => t.id !== id);
	},
};

function add(message: string, type: Toast['type']) {
	const id = ++counter;
	toasts = [...toasts, { id, message, type }];
	setTimeout(() => {
		toasts = toasts.filter((t) => t.id !== id);
	}, 4000);
}
