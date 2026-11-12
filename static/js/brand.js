"use strict";

function replaceBranding(value) {
	return value.replaceAll("PayPlus", "PayPlus").replaceAll("PAYPLUS", "PAYPLUS").replaceAll("payplus", "payplus");
}

document.title = replaceBranding(document.title);
const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
const textNodes = [];
while (textWalker.nextNode()) textNodes.push(textWalker.currentNode);
for (const node of textNodes) node.nodeValue = replaceBranding(node.nodeValue);
for (const element of document.querySelectorAll("[aria-label], [title]")) {
	if (element.hasAttribute("aria-label")) element.setAttribute("aria-label", replaceBranding(element.getAttribute("aria-label")));
	if (element.hasAttribute("title")) element.setAttribute("title", replaceBranding(element.getAttribute("title")));
}
