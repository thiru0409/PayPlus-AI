"""Token-light product discovery links for the PayPlus Pet."""

from urllib.parse import quote_plus


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
	return " ".join(text.split()).strip("?.!,") or "products"


def search_product_links(question: str) -> dict:
	"""Return marketplace searches without claiming a seller accepts PayPal."""
	query = _clean_query(question)
	encoded = quote_plus(query)
	return {
		"query": query,
		"results": [
			{
				"marketplace": marketplace,
				"title": f"Search {marketplace} for {query}",
				"url": template.format(query=encoded),
				"paypal_note": "Check the seller's checkout for PayPal availability.",
			}
			for marketplace, template in MARKETPLACES
		],
	}
