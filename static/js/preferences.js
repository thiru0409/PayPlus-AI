"use strict";

const PREFERENCE_KEY = "payplus-ai.preferences.v1";
const WIDGET_KEYS = [
	"financialSummary",
	"monthlyAnalytics",
	"recentTransactions",
	"aiInsights",
	"securityAlerts",
];

const DEFAULT_PREFERENCES = {
	theme: "system",
	accent: "blue",
	spacing: "comfortable",
	chartType: "bar",
	fontSize: "default",
	highContrast: false,
	reducedMotion: false,
	widgets: {
		financialSummary: true,
		monthlyAnalytics: true,
		recentTransactions: true,
		aiInsights: true,
		securityAlerts: true,
	},
	widgetOrder: [...WIDGET_KEYS],
};

function normalizedPreferences(candidate) {
	const input = candidate && typeof candidate === "object" ? candidate : {};
	const widgets = input.widgets && typeof input.widgets === "object" ? input.widgets : {};
	const requestedOrder = Array.isArray(input.widgetOrder) ? input.widgetOrder : [];
	const widgetOrder = [
		...requestedOrder.filter((key, index) => WIDGET_KEYS.includes(key) && requestedOrder.indexOf(key) === index),
		...WIDGET_KEYS.filter((key) => !requestedOrder.includes(key)),
	];
	return {
		theme: ["light", "dark", "system"].includes(input.theme) ? input.theme : DEFAULT_PREFERENCES.theme,
		accent: ["blue", "purple", "green", "orange"].includes(input.accent) ? input.accent : DEFAULT_PREFERENCES.accent,
		spacing: ["comfortable", "compact"].includes(input.spacing) ? input.spacing : DEFAULT_PREFERENCES.spacing,
		chartType: ["line", "bar", "area"].includes(input.chartType) ? input.chartType : DEFAULT_PREFERENCES.chartType,
		fontSize: ["small", "default", "large"].includes(input.fontSize) ? input.fontSize : DEFAULT_PREFERENCES.fontSize,
		highContrast: input.highContrast === true,
		reducedMotion: input.reducedMotion === true,
		widgets: Object.fromEntries(WIDGET_KEYS.map((key) => [key, widgets[key] !== false])),
		widgetOrder,
	};
}

function readPreferences() {
	try {
		return normalizedPreferences(JSON.parse(localStorage.getItem(PREFERENCE_KEY) || "{}"));
	} catch {
		return normalizedPreferences(DEFAULT_PREFERENCES);
	}
}

function syncPreferenceControls(preferences) {
	const theme = document.querySelector("#themeChoice");
	const spacing = document.querySelector("#spacingChoice");
	const chart = document.querySelector("#preferredChart");
	const fontSize = document.querySelector("#fontSizeChoice");
	const highContrast = document.querySelector("#highContrastChoice");
	const reducedMotion = document.querySelector("#reducedMotionChoice");
	if (theme) theme.value = preferences.theme;
	if (spacing) spacing.value = preferences.spacing;
	if (chart) chart.value = preferences.chartType;
	if (fontSize) fontSize.value = preferences.fontSize;
	if (highContrast) highContrast.checked = preferences.highContrast;
	if (reducedMotion) reducedMotion.checked = preferences.reducedMotion;
	for (const button of document.querySelectorAll("[data-accent-choice]")) {
		button.setAttribute("aria-pressed", String(button.dataset.accentChoice === preferences.accent));
	}
	for (const checkbox of document.querySelectorAll("[data-widget-choice]")) {
		checkbox.checked = preferences.widgets[checkbox.dataset.widgetChoice];
	}
	const orderList = document.querySelector("#widgetOrderList");
	if (orderList) {
		const items = new Map(
			[...orderList.querySelectorAll("[data-widget-order]")].map((item) => [item.dataset.widgetOrder, item]),
		);
		for (const key of preferences.widgetOrder) {
			if (items.has(key)) orderList.append(items.get(key));
		}
	}
}

function applyPreferences(preferences) {
	const root = document.documentElement;
	const followsDarkSystemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches;
	root.dataset.themePreference = preferences.theme;
	root.dataset.theme = preferences.theme === "system"
		? (followsDarkSystemTheme ? "dark" : "light")
		: preferences.theme;
	root.dataset.accent = preferences.accent;
	root.dataset.spacing = preferences.spacing;
	root.dataset.fontSize = preferences.fontSize;
	root.dataset.contrast = preferences.highContrast ? "high" : "normal";
	root.dataset.reducedMotion = String(preferences.reducedMotion);

	const dashboard = document.querySelector("#dashboardWidgets");
	if (dashboard) {
		const widgets = new Map(
			[...dashboard.querySelectorAll("[data-widget]")].map((item) => [item.dataset.widget, item]),
		);
		for (const key of preferences.widgetOrder) {
			const widget = widgets.get(key);
			if (widget) {
				widget.hidden = !preferences.widgets[key];
				dashboard.append(widget);
			}
		}
	}
	syncPreferenceControls(preferences);
	document.dispatchEvent(new CustomEvent("payplus:preferences-applied", { detail: preferences }));
}

let currentPreferences = readPreferences();
applyPreferences(currentPreferences);

window.payplusPreferences = {
	get() {
		return normalizedPreferences(currentPreferences);
	},
	save(changes) {
		currentPreferences = normalizedPreferences({ ...currentPreferences, ...changes });
		try {
			localStorage.setItem(PREFERENCE_KEY, JSON.stringify(currentPreferences));
		} catch {
			const feedback = document.querySelector("#settingsFeedback");
			if (feedback) feedback.textContent = "Browser storage is unavailable; changes may not persist.";
		}
		applyPreferences(currentPreferences);
		const saved = document.querySelector("#settingsSaved");
		if (saved) saved.textContent = "Saved in this browser";
		return this.get();
	},
	reset() {
		currentPreferences = normalizedPreferences(DEFAULT_PREFERENCES);
		try {
			localStorage.removeItem(PREFERENCE_KEY);
		} catch {
			// Defaults still apply for this page if browser storage is blocked.
		}
		applyPreferences(currentPreferences);
		return this.get();
	},
};

const systemThemePreference = window.matchMedia("(prefers-color-scheme: dark)");
systemThemePreference.addEventListener?.("change", () => {
	if (window.payplusPreferences.get().theme === "system") {
		applyPreferences(currentPreferences);
	}
});