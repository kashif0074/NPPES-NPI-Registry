"""
search.py - Search Adapter for Provider Web Research.
Integrates Tavily (primary / default) and Google Custom Search JSON API (optional).
"""

import os
import requests
from dotenv import load_dotenv

load_dotenv()


class SearchError(RuntimeError):
    pass


def search_web(query, domains=None, provider=None):
    provider = provider or os.getenv("SEARCH_PROVIDER", "tavily")
    try:
        if provider == "google":
            return google_search(query, domains)
        if provider == "tavily":
            return tavily_search(query, domains)
        raise SearchError("Unsupported search provider")
    except requests.RequestException:
        # Do not return exception strings: Google URLs can contain API keys.
        raise SearchError(
            f"{provider} request failed. Check API access, quota, and network."
        ) from None


def tavily_search(query, domains=None):
    key = os.getenv("TAVILY_API_KEY")
    if not key:
        raise SearchError("TAVILY_API_KEY is missing")
    payload = {
        "query": query,
        "search_depth": "basic",
        "max_results": 5,
        "include_answer": False,
        "include_raw_content": False,
    }
    if domains:
        payload["include_domains"] = domains
    response = requests.post(
        "https://api.tavily.com/search",
        headers={"Authorization": f"Bearer {key}"},
        json=payload,
        timeout=30,
    )
    response.raise_for_status()
    return [
        {
            "title": item.get("title", ""),
            "url": item["url"],
            "snippet": item.get("content", ""),
            "engine": "tavily",
        }
        for item in response.json().get("results", [])
        if item.get("url")
    ]


def google_search(query, domains=None):
    key = os.getenv("GOOGLE_API_KEY")
    cx = os.getenv("GOOGLE_CX")
    if not key or not cx:
        raise SearchError("GOOGLE_API_KEY or GOOGLE_CX is missing")
    if domains:
        restrictions = " OR ".join(f"site:{domain}" for domain in domains)
        query = f"{query} ({restrictions})"
    response = requests.get(
        "https://www.googleapis.com/customsearch/v1",
        params={
            "key": key,
            "cx": cx,
            "q": query,
            "num": 5,
        },
        timeout=30,
    )
    response.raise_for_status()
    return [
        {
            "title": item.get("title", ""),
            "url": item["link"],
            "snippet": item.get("snippet", ""),
            "engine": "google",
        }
        for item in response.json().get("items", [])
        if item.get("link")
    ]
