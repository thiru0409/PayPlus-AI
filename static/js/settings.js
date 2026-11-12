"use strict";

const preferences = window.payplusPreferences;
const settingsFeedback = document.querySelector("#settingsFeedback");
const settingsSaved = document.querySelector("#settingsSaved");
const widgetOrderList = document.querySelector("#widgetOrderList");

function savePreference(key, value) {
	preferences.save({ [key]: value });
	settingsFeedback.textContent = "Changes save automatically in this browser.";
	settingsSaved.textContent = "Saved in this browser";
}

document.querySelector("#themeChoice").addEventListener("change", (event) => {
	savePreference("theme", event.currentTarget.value);
});

document.querySelector("#spacingChoice").addEventListener("change", (event) => {
	savePreference("spacing", event.currentTarget.value);
});

document.querySelector("#preferredChart").addEventListener("change", (event) => {
	savePreference("chartType", event.currentTarget.value);
});

document.querySelector("#fontSizeChoice").addEventListener("change", (event) => {
	savePreference("fontSize", event.currentTarget.value);
});

document.querySelector("#highContrastChoice").addEventListener("change", (event) => {
	savePreference("highContrast", event.currentTarget.checked);
});

document.querySelector("#reducedMotionChoice").addEventListener("change", (event) => {
	savePreference("reducedMotion", event.currentTarget.checked);
});

for (const button of document.querySelectorAll("[data-accent-choice]")) {
	button.addEventListener("click", () => savePreference("accent", button.dataset.accentChoice));
}

for (const checkbox of document.querySelectorAll("[data-widget-choice]")) {
	checkbox.addEventListener("change", () => {
		const current = preferences.get();
		preferences.save({
			widgets: {
				...current.widgets,
				[checkbox.dataset.widgetChoice]: checkbox.checked,
			},
		});
		settingsFeedback.textContent = "Dashboard widgets updated. Changes save in this browser.";
		settingsSaved.textContent = "Saved in this browser";
	});
}

function saveWidgetOrder() {
	const widgetOrder = [...widgetOrderList.querySelectorAll("[data-widget-order]")]
		.map((item) => item.dataset.widgetOrder);
	preferences.save({ widgetOrder });
	settingsFeedback.textContent = "Dashboard order updated and saved in this browser.";
	settingsSaved.textContent = "Saved in this browser";
}

widgetOrderList.addEventListener("click", (event) => {
	const button = event.target.closest("button[data-move]");
	if (!button) return;
	const item = button.closest("[data-widget-order]");
	if (button.dataset.move === "up" && item.previousElementSibling) {
		widgetOrderList.insertBefore(item, item.previousElementSibling);
		saveWidgetOrder();
	} else if (button.dataset.move === "down" && item.nextElementSibling) {
		widgetOrderList.insertBefore(item.nextElementSibling, item);
		saveWidgetOrder();
	}
});

let draggedWidget;
widgetOrderList.addEventListener("dragstart", (event) => {
	draggedWidget = event.target.closest("[data-widget-order]");
	if (!draggedWidget) return;
	draggedWidget.classList.add("is-dragging");
	event.dataTransfer.effectAllowed = "move";
	event.dataTransfer.setData("text/plain", draggedWidget.dataset.widgetOrder);
});

widgetOrderList.addEventListener("dragover", (event) => {
	event.preventDefault();
	const target = event.target.closest("[data-widget-order]");
	if (!target || !draggedWidget || target === draggedWidget) return;
	const bounds = target.getBoundingClientRect();
	const insertAfter = event.clientY > bounds.top + bounds.height / 2;
	widgetOrderList.insertBefore(draggedWidget, insertAfter ? target.nextElementSibling : target);
});

widgetOrderList.addEventListener("drop", (event) => {
	event.preventDefault();
	if (draggedWidget) saveWidgetOrder();
});

widgetOrderList.addEventListener("dragend", () => {
	draggedWidget?.classList.remove("is-dragging");
	draggedWidget = undefined;
});

document.querySelector("#resetSettings").addEventListener("click", () => {
	if (!window.confirm("Reset all appearance, layout, and accessibility settings to their defaults?")) {
		return;
	}
	preferences.reset();
	settingsFeedback.textContent = "Settings reset to defaults and saved in this browser.";
	settingsSaved.textContent = "Defaults restored";
});