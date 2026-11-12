"use strict";

const petButton = document.createElement("button");
petButton.className = "payplus-pet-button";
petButton.type = "button";
petButton.setAttribute("aria-label", "Open PayPlus Pet assistant");
petButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="6" width="14" height="13" rx="3"/><path d="M9 6V4h6v2M8 11h.01M16 11h.01M9 15h6M3 10h2m14 0h2"/></svg>`;

const petPanel = document.createElement("section");
petPanel.className = "payplus-pet-panel";
petPanel.hidden = true;
petPanel.innerHTML = `
	<div class="payplus-pet-heading"><div><strong>PayPlus Pet</strong><span>Money, shopping, and PayPal help</span></div><button type="button" aria-label="Close PayPlus Pet">×</button></div>
	<div class="payplus-pet-messages" aria-live="polite"><p class="payplus-pet-welcome">Ask me about spending or ask me to find any products</p></div>
	<form class="payplus-pet-form"><input maxlength="300" placeholder="Ask or find a product…" aria-label="Ask PayPlus Pet"><button type="submit">Send</button></form>
`;
document.body.append(petButton, petPanel);
document.querySelectorAll('a[href="/assistant"]').forEach((link) => link.remove());

const petMessages = petPanel.querySelector(".payplus-pet-messages");
const petForm = petPanel.querySelector(".payplus-pet-form");
const petInput = petForm.querySelector("input");
petButton.addEventListener("click", () => {
	petPanel.hidden = !petPanel.hidden;
	if (!petPanel.hidden) petInput.focus();
});
petPanel.querySelector(".payplus-pet-heading button").addEventListener("click", () => {
	petPanel.hidden = true;
});
function addPetMessage(text, role) {
	const message = document.createElement("p");
	message.className = `payplus-pet-message ${role}`;
	message.textContent = text;
	petMessages.append(message);
	petMessages.scrollTop = petMessages.scrollHeight;
}
petForm.addEventListener("submit", async (event) => {
	event.preventDefault();
	const question = petInput.value.trim();
	if (!question) return;
	petInput.value = "";
	addPetMessage(question, "user");
	try {
		const response = await fetch("/api/assistant/message", {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({ question }),
		});
		const payload = await response.json();
		if (!response.ok) throw new Error(payload.error?.message || "The pet could not answer.");
		addPetMessage(payload.data.answer, "assistant");
		const results = payload.data.shopping?.results || [];
		let productGrid = null;
		if (results.length) {
			productGrid = document.createElement("div");
			productGrid.className = "payplus-pet-product-grid";
			petMessages.append(productGrid);
		}
		for (const result of results) {
			const link = document.createElement("a");
			link.className = "payplus-pet-result";
			link.href = result.url;
			link.target = "_blank";
			link.rel = "noopener noreferrer";
			link.innerHTML = `<div class="payplus-pet-result-media"></div><div class="payplus-pet-result-copy"><small></small><strong></strong><b></b><span></span><em>View listing</em></div>`;
			if (result.image_url) {
				const image = document.createElement("img");
				image.src = result.image_url;
				image.alt = result.title;
				image.loading = "lazy";
				link.querySelector(".payplus-pet-result-media").append(image);
			} else {
				link.querySelector(".payplus-pet-result-media").innerHTML = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="10" width="32" height="28" rx="4"/><path d="m12 32 8-8 6 6 4-4 6 6M17 19h.01"/></svg>`;
			}
			link.querySelector("small").textContent = result.marketplace || "Product listing";
			link.querySelector("strong").textContent = result.title;
			link.querySelector("b").textContent = result.price || "Price shown on listing";
			link.querySelector("span").textContent = result.paypal_note;
			productGrid?.append(link);
		}
	} catch (error) {
		addPetMessage(error.message, "assistant");
	}
});
