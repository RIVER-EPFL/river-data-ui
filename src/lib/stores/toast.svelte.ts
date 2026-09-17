export interface Toast {
	id: number;
	message: string;
	type: 'success' | 'error' | 'info';
	action?: ToastAction;
}

export interface ToastAction {
	label: string;
	run: () => void;
}

let counter = 0;
let toasts = $state<Toast[]>([]);

export const toastStore = {
	get items() {
		return toasts;
	},
	success(message: string, action?: ToastAction) {
		add(message, 'success', action);
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

function add(message: string, type: Toast['type'], action?: ToastAction) {
	const id = ++counter;
	toasts = [...toasts, { id, message, type, action }];
	// An undo needs longer to reach than a message needs to read.
	setTimeout(() => {
		toasts = toasts.filter((t) => t.id !== id);
	}, action ? 10000 : 4000);
}
