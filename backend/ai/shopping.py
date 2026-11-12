"""Token-light product discovery links for the PayPlus Pet."""

from urllib.parse import quote_plus
from html import unescape
import re
import xml.etree.ElementTree as ET

import requests


MARKETPLACES = (
	("Google Shopping", "https://www.google.com/search?tbm=shop&q={query}"),
	("eBay", "https://www.ebay.com/sch/i.html?_nkw={query}"),
	("Amazon", "https://www.amazon.com/s?k={query}"),
	("Walmart", "https://www.walmart.com/search?q={query}"),
	("Etsy", "https://www.etsy.com/search?q={query}"),
	("AliExpress", "https://www.aliexpress.com/w/wholesale-{query}.html"),
)


def _clean_query(question: str) -> str:
	text = question.casefold()
	for phrase in (
		"find me", "find", "search for", "search", "look for", "buy me",
		"buy", "shop for", "shop", "recommend", "recommendations", "product",
		"products", "please", "i want", "i need",
	):
		text = text.replace(phrase, " ")
	query = " ".join(text.split()).strip("?.!,") or "products"
	return re.sub(r"^(a|an|the)\s+", "", query)


def _price_from_text(text: str) -> str:
	match = re.search(r"(?:[$€£₹]\s?\d[\d,]*(?:\.\d{2})?|(?:USD|EUR|GBP|INR)\s?\d[\d,]*(?:\.\d{2})?)", text, re.IGNORECASE)
	return match.group(0) if match else "Price shown on listing"


def _live_results(query: str) -> list[dict]:
	try:
		response = requests.get(
			"https://www.bing.com/search",
			params={"format": "rss", "q": f"{query} buy price"},
			headers={"User-Agent": "PayPlus/1.0"},
			timeout=10,
		)
		response.raise_for_status()
		root = ET.fromstring(response.text)
	except (requests.RequestException, ET.ParseError):
		return []
	results = []
	for item in root.findall("./channel/item")[:8]:
		title = unescape((item.findtext("title") or "").strip())
		url = (item.findtext("link") or "").strip()
		description = unescape(re.sub(r"<[^>]+>", " ", item.findtext("description") or "")).strip()
		search_terms = [term for term in query.casefold().split() if len(term) > 2]
		combined_text = f"{title} {description}".casefold()
		if title and url and search_terms and any(term in combined_text for term in search_terms):
			listing_image = _listing_image(url)
			results.append({
				"marketplace": "Live web listing",
				"title": title,
				"url": url,
				"price": _price_from_text(f"{title} {description}"),
				# Only show an image extracted from this exact listing URL. Never
				# pair a generic image-search result with a different product title.
				"image_url": listing_image,
				"paypal_note": "Confirm PayPal and shipping availability at checkout.",
			})
	return results


def _listing_image(url: str) -> str:
	"""Return a listing's own Open Graph image, if it exposes one."""
	try:
		response = requests.get(
			url,
			headers={"User-Agent": "Mozilla/5.0 PayPlus/1.0"},
			timeout=4,
		)
		if response.status_code >= 400:
			return ""
		markup = response.text[:500_000]
		match = re.search(
			r'<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)',
			markup,
			re.IGNORECASE,
		)
		return unescape(match.group(1)).strip() if match else ""
	except (requests.RequestException, ValueError):
		return ""


def search_product_links(question: str) -> dict:
	"""Return live listing results with marketplace fallback links."""
	query = _clean_query(question)
	encoded = quote_plus(query)
	live_results = _live_results(query)
	if live_results:
		return {"query": query, "results": live_results, "live": True}
	return {
		"query": query,
		"live": False,
		"results": [
			{
				"marketplace": marketplace,
				"title": f"Search {marketplace} for {query}",
				"url": template.format(query=encoded),
				"price": "Open listings for live prices",
				# Marketplace fallback links are search pages, not product listings.
				# Leave the image empty instead of displaying an unrelated thumbnail.
				"image_url": "",
				"paypal_note": "Check the seller's checkout for PayPal availability.",
			}
			for index, (marketplace, template) in enumerate(MARKETPLACES)
		],
	}
