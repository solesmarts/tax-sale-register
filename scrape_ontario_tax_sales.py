"""
Ontario Tax Sale scraper
-------------------------
Pulls "Sale of Land for Tax Arrears by Public Tender" notices from the
current Ontario Gazette issue and parses them into structured JSON.

Why the Gazette, and not 444 municipal websites:
Every Ontario municipal tax sale must, by O. Reg 181/03, be advertised in
The Ontario Gazette at least 60 days before the tender closes. That makes
the Gazette a single, canonical, weekly-updated source instead of one
scraper per municipality.

This script is designed to be run on a schedule outside of any chat
session — e.g. a weekly cron job or a GitHub Actions workflow — since the
Gazette publishes a new issue every Saturday. Each run:
  1. Finds the latest issue's "Sale of Land for Tax Arrears" page.
  2. Parses every municipality's notice block into individual property
     records (a notice can list one property or several).
  3. Writes/updates listings.json, keyed by Gazette reference number so
     re-running is idempotent (existing listings aren't duplicated).

Usage:
    pip install requests beautifulsoup4
    python scrape_ontario_tax_sales.py [--out listings.json]

Notes:
  - The Gazette issue URL follows a predictable pattern
    (.../ontario-gazette-volume-V-issue-N-<date>/sale-land-tax-arrears-public-tender)
    but V/N/date must be discovered — see find_latest_issue_url().
  - This is intentionally a starting point: the notice text is written by
    ~440 different municipal clerks and isn't perfectly uniform. Treat
    parse failures as expected; the script logs and skips blocks it can't
    confidently parse rather than guessing.
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests
from bs4 import BeautifulSoup

GAZETTE_SEARCH_URL = "https://www.ontario.ca/search/ontario-gazette"
HEADERS = {"User-Agent": "tax-sale-aggregator/1.0 (personal research tool)"}


def find_latest_issue_url() -> str:
    """Locate the most recent Gazette issue's tax-sale page.

    Ontario.ca doesn't expose a clean API for this, so we search the
    Gazette index page and follow the newest issue link. If ontario.ca
    changes its markup this will need a small update — that's expected
    and is exactly why parsing failures here are logged loudly rather
    than failing silently.
    """
    resp = requests.get(GAZETTE_SEARCH_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    issue_link = None
    for a in soup.find_all("a", href=True):
        if re.search(r"/document/ontario-gazette-volume-\d+-issue-\d+", a["href"]):
            issue_link = a["href"]
            break

    if not issue_link:
        raise RuntimeError("Could not locate a Gazette issue link — check GAZETTE_SEARCH_URL markup")

    base = issue_link if issue_link.startswith("http") else f"https://www.ontario.ca{issue_link}"
    return base.rstrip("/") + "/sale-land-tax-arrears-public-tender"


MONEY_RE = r"\$[\d,]+(?:\.\d{2})?"


def parse_amount(text: str) -> float:
    return float(text.replace("$", "").replace(",", ""))


def parse_notice_page(html: str) -> list[dict]:
    """Split the tax-arrears page into per-municipality notices, then
    per-property records within each notice.

    This works on the page's flattened text rather than its tag structure.
    Government CMS markup (permalink icons nested inside headings, wrapper
    divs, etc.) varies and breaks tag-based matching in ways that are hard
    to predict in advance; matching on the text every notice is legally
    required to contain is far more durable.
    """
    soup = BeautifulSoup(html, "html.parser")
    content = soup.find("main") or soup
    full_text = content.get_text("\n", strip=True)

    # Every notice heading is "The Corporation of the <Town/Township/City/
    # Municipality/County> of <Name>" — required wording under O. Reg
    # 181/03. The same phrase also appears a second time near the bottom
    # of each notice, in the clerk's signature block (e.g. "Darlene Peever,
    # Tax Collector, The Corporation of the Town of Kirkland Lake..."), so
    # matching the phrase alone over-splits each notice in two. A real
    # heading is always immediately followed by "Take Notice that tenders
    # are invited" — the signature-block mention isn't — so use that as
    # the disambiguator.
    heading_re = re.compile(
        r"The Corporation of the (?:Town|Township|City|Municipality|County|Village)s? of [^\n]+"
    )
    heading_matches = [
        m
        for m in heading_re.finditer(full_text)
        if re.search(r"Take\s*Notice", full_text[m.end(): m.end() + 120], re.IGNORECASE)
    ]

    print(f"Found {len(heading_matches)} municipality headings", file=sys.stderr)
    if not heading_matches:
        # Surface a snippet so a failed run is diagnosable from the Actions
        # log instead of just silently producing an empty file.
        print("First 500 chars of fetched page text:", file=sys.stderr)
        print(full_text[:500], file=sys.stderr)
        return []

    records = []
    for i, m in enumerate(heading_matches):
        municipality = m.group(0).strip()
        block_start = m.end()
        block_end = heading_matches[i + 1].start() if i + 1 < len(heading_matches) else len(full_text)
        block_text = full_text[block_start:block_end]

        closing_match = re.search(
            r"3:00\s*p\.?m\.?\s*local time on\s+([A-Za-z]+ \d{1,2},?\s*\d{4})",
            block_text,
        )
        closing_date = None
        if closing_match:
            try:
                closing_date = datetime.strptime(
                    closing_match.group(1).replace(",", ""), "%B %d %Y"
                ).date().isoformat()
            except ValueError:
                pass

        gazette_ref_match = re.search(r"\((\d+-P\d+)\)", block_text)
        gazette_ref = gazette_ref_match.group(1) if gazette_ref_match else None

        print(
            f"  [{municipality[:45]}] block length {len(block_text)} chars, "
            f"'Roll No' appears {block_text.count('Roll No')}x, "
            f"'Minimum Tender' appears {block_text.count('Minimum Tender')}x",
            file=sys.stderr,
        )

        # Each property is introduced by "Roll No." somewhere before its own
        # "Minimum Tender Amount: $X" line.
        property_chunks = re.split(r"(?=Roll No)", block_text)
        for chunk in property_chunks:
            tender_match = re.search(r"Minimum Tender Amount:?\s*(" + MONEY_RE + r")", chunk)
            if not tender_match:
                continue

            # Roll number: the digit/space/dash run right after "Roll No.",
            # cut off at the first non-numeric separator (semicolon, en
            # dash, hyphen-word boundary, or newline) rather than requiring
            # one specific terminator.
            roll_match = re.search(
                r"Roll No\.?\s*\(?Number\)?:?\s*([0-9][0-9 \-]*[0-9])", chunk
            )
            pin_match = re.search(r"\b(\d{5}[\-\u2013]\d{4})\b", chunk)
            assessed_match = re.search(
                r"assessed value of the land is\s*(" + MONEY_RE + r")", chunk
            )
            file_match = re.search(r"File No\.?\s*\(?Number\)?:?\s*([\w\-]+)", chunk)
            # Address: best-effort — the first "<number/street>, <place>"
            # fragment before the PIN. Left as None if it can't be isolated
            # confidently rather than guessing.
            addr_match = re.search(
                r";\s*([A-Za-z0-9][^;\n]{3,60}?,\s*[A-Za-z][^;\n]{2,40}?)\s*;", chunk
            )

            records.append(
                {
                    "municipality": municipality,
                    "roll_no": roll_match.group(1).strip() if roll_match else None,
                    "address": addr_match.group(1).strip() if addr_match else None,
                    "pin": pin_match.group(1).strip() if pin_match else None,
                    "assessed_value": parse_amount(assessed_match.group(1)) if assessed_match else None,
                    "min_tender": parse_amount(tender_match.group(1)),
                    "file_no": file_match.group(1).strip() if file_match else None,
                    "closing_date": closing_date,
                    "gazette_ref": gazette_ref,
                    "scraped_at": datetime.now(timezone.utc).isoformat(),
                }
            )

    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="listings.json", help="Output JSON path")
    parser.add_argument("--url", help="Fetch a specific Gazette issue URL instead of auto-discovering the latest")
    args = parser.parse_args()

    url = args.url or find_latest_issue_url()
    print(f"Fetching {url}", file=sys.stderr)

    resp = requests.get(url, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    new_records = parse_notice_page(resp.text)
    print(f"Parsed {len(new_records)} property records", file=sys.stderr)

    out_path = Path(args.out)
    existing = json.loads(out_path.read_text()) if out_path.exists() else []
    existing_keys = {(r["gazette_ref"], r["roll_no"] or r["min_tender"]) for r in existing}

    added = 0
    for rec in new_records:
        key = (rec["gazette_ref"], rec["roll_no"] or rec["min_tender"])
        if key not in existing_keys:
            existing.append(rec)
            existing_keys.add(key)
            added += 1

    out_path.write_text(json.dumps(existing, indent=2))
    print(f"Added {added} new records, {len(existing)} total in {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
