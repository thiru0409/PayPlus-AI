"use strict";

const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const chatHistory = document.querySelector("#chatHistory");
const chatLoading = document.querySelector("#chatLoading");
const chatError = document.querySelector("#chatError");
const sendButton = document.querySelector("#sendMessage");
const CHAT_STORAGE_KEY = "payplus-ai.assistant-session.v1";
const conversation = [];

function saveConversation() {
	try {
		sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(conversation.slice(-60)));
	} catch {
		// The current page conversation still works if browser storage is blocked.
	}
}

function makeChatMessage(role, text, source = "") {
	const isAssistant = role === "assistant";
	const message = document.createElement("div");
	message.className = `chat-message ${isAssistant ? "assistant-message" : "user-message"}`;
	const avatar = document.createElement("span");
	avatar.className = "chat-avatar";
	avatar.setAttribute("aria-hidden", "true");
	avatar.textContent = isAssistant ? "P" : "You";
	const body = document.createElement("div");
	body.className = "message-body";
	const author = document.createElement("span");
	author.className = "message-author";
	author.textContent = isAssistant ? "PayPlus Assistant" : "You";
	const paragraph = document.createElement("p");
	paragraph.textContent = text;
	body.append(author, paragraph);
	if (isAssistant && source) {
		const sourceLabel = document.createElement("span");
		sourceLabel.className = "message-source";
		sourceLabel.textContent = source;
		body.append(sourceLabel);
	}
	message.append(avatar, body);
	return message;
}

function appendShoppingResults(data) {
	if (!data?.shopping?.results?.length) {
		return;
	}
	const group = document.createElement("div");
	group.className = "shopping-results";
	for (const item of data.shopping.results) {
		const card = document.createElement("a");
		card.className = "shopping-card";
		card.href = item.url;
		card.target = "_blank";
		card.rel = "noopener noreferrer";
		const title = document.createElement("strong");
		title.textContent = item.title;
		const note = document.createElement("span");
		note.textContent = item.paypal_note;
		card.append(title, note);
		group.append(card);
	}
	chatHistory.append(group);
}

function renderConversation() {
	chatHistory.replaceChildren(
		...conversation.map((message) => makeChatMessage(message.role, message.text, message.source)),
	);
	chatHistory.scrollTop = chatHistory.scrollHeight;
}

function restoreConversation() {
	try {
		const stored = JSON.parse(sessionStorage.getItem(CHAT_STORAGE_KEY) || "null");
		if (Array.isArray(stored)) {
			for (const message of stored.slice(-60)) {
				if (
					message &&
					["user", "assistant"].includes(message.role) &&
					typeof message.text === "string" &&
					message.text.length <= 2000
				) {
					conversation.push({
						role: message.role,
						text: message.text,
						source: typeof message.source === "string" ? message.source : "",
					});
				}
			}
		}
	} catch {
		conversation.length = 0;
	}
	if (conversation.length) {
		renderConversation();
	}
}

function setLoading(isLoading) {
	chatLoading.hidden = !isLoading;
	chatInput.disabled = isLoading;
	sendButton.disabled = isLoading;
	for (const button of document.querySelectorAll(".suggestion-chip")) {
		button.disabled = isLoading;
	}
	if (isLoading) {
		chatHistory.scrollTop = chatHistory.scrollHeight;
	}
}

async function sendQuestion(rawQuestion) {
	const question = rawQuestion.trim();
	if (!question) {
		chatError.textContent = "Type a question or choose one of the suggestions.";
		chatError.hidden = false;
		chatInput.focus();
		return;
	}
	if (question.length > 300) {
		chatError.textContent = "Please keep your question to 300 characters or fewer.";
		chatError.hidden = false;
		return;
	}

	chatError.hidden = true;
	conversation.push({ role: "user", text: question, source: "" });
	renderConversation();
	saveConversation();
	chatInput.value = "";
	setLoading(true);
	try {
		const response = await fetch("/api/assistant/message", {
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "application/json" },
			body: JSON.stringify({ question }),
		});
		const payload = await response.json();
		if (!response.ok) {
			throw new Error(payload.error?.message || "I couldn't check your records just now.");
		}
		conversation.push({
			role: "assistant",
			text: payload.data.answer,
			source: payload.data.source,
		});
		renderConversation();
		appendShoppingResults(payload.data);
		saveConversation();
	} catch (error) {
		console.error("The assistant request failed.", error);
		chatError.textContent = error.message || "I couldn't reach the local data service. Please try again.";
		chatError.hidden = false;
	} finally {
		setLoading(false);
		chatInput.focus();
	}
}

chatForm.addEventListener("submit", (event) => {
	event.preventDefault();
	sendQuestion(chatInput.value);
});

chatInput.addEventListener("keydown", (event) => {
	if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
		event.preventDefault();
		chatForm.requestSubmit();
	}
});

document.querySelector("#suggestedQuestions").addEventListener("click", (event) => {
	const button = event.target.closest("button[data-question]");
	if (button && !sendButton.disabled) {
		sendQuestion(button.dataset.question);
	}
});

document.querySelector("#clearConversation").addEventListener("click", () => {
	if (!window.confirm("Clear this conversation from this browser tab?")) {
		return;
	}
	conversation.length = 0;
	try {
		sessionStorage.removeItem(CHAT_STORAGE_KEY);
	} catch {
		// Clearing the visible conversation still works if browser storage is blocked.
	}
	chatHistory.replaceChildren();
	chatHistory.append(makeChatMessage(
		"assistant",
		"I can help you understand your saved transaction records. Choose a question below or ask one in your own words.",
		"Local data summary",
	));
	chatError.hidden = true;
});

restoreConversation();
