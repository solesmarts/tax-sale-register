"""
Ontario Tax Sale scraper
-------------------------
Pulls "Sale of Land for Tax Arrears" notices — both public-tender and
public-auction sales — from recent Ontario Gazette issues and parses them
into structured JSON.

Why the Gazette, and not 444 municipal websites:
Every Ontario municipal tax sale must, by O. Reg 181/03, be advertised in
The Ontario Gazette at least 60 days before the sale closes. That makes
the Gazette a single, canonical, weekly-updated source instead of one
scraper per municipality.

Two sale methods, two pages per issue:
Municipalities sell either by public tender or public auction under the
same regulation, and the Gazette publishes them on separate pages per
issue (".../sale-land-tax-arrears-public-tender" and
".../sale-land-tax-arrears-public-auction"). An issue can also carry more
than one page of the same type (observed as a "-0" suffix) when there's a
lot of that week's content. Rather than guessing suffixes, this script
reads each issue's own table-of-contents page and follows every link that
looks like a tax-arrears notice, of either type.

Why a multi-week backfill, and why dedup can't key on the issue:
A notice typically gets republished in several consecutive weekly issues
until its closing date passes (the regulation requires ongoing notice, not
a single one-off ad). That means the *same* property shows up under a
*different* Gazette reference every week it's reprinted. Deduplication
therefore keys on the property itself (municipality + roll number, or a
fallback identity when the roll number didn't parse) — never on the
Gazette reference, which changes every reprint. When a listing shows up
again under a newer issue, the newer copy's data wins (it may have been
corrected or postponed since); closed listings (closing date already
passed) are dropped from the output entirely.

Usage:
    pip install requests beautifulsoup4
    python scrape_ontario_tax_sales.py [--out listings.json] [--weeks N]

    --weeks 1  (default) — just the current issue; what the weekly
               scheduled run should use.
    --weeks 13 — roughly a 3-month backfill; run this once manually to
               seed listings.json, or any time you suspect the file has
               drifted from what's actually open.

Notes:
  - This is intentionally a starting point: the notice text is written by
    ~440 different municipal clerks and isn't perfectly uniform. Treat
    parse failures as expected; the script logs and skips blocks it can't
    confidently parse rather than guessing.
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
from bs4 import BeautifulSoup

GAZETTE_SEARCH_URL = "https://www.ontario.ca/search/ontario-gazette"
HEADERS = {"User-Agent": "tax-sale-aggregator/1.0 (personal research tool)"}
MONEY_RE = r"\$[\d,]+(?:\.\d{2})?"


def parse_amount(text: str) -> float:
    return float(text.replace("$", "").replace(",", ""))


def find_latest_issue_anchor() -> dict:
    """Locate the most recent Gazette issue and pull its volume, issue
    number, and date out of the URL — these become the anchor point for
    walking backward through prior weeks."""
    resp = requests.get(GAZETTE_SEARCH_URL, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    for a in soup.find_all("a", href=True):
        m = re.search(
            r"/document/(ontario-gazette-volume-(\d+)-issue-(\d+)-([a-z]+-\d{1,2}-\d{4}))",
            a["href"],
            re.IGNORECASE,
        )
        if not m:
            continue
        slug, volume, issue_num, date_slug = m.groups()
        try:
            date = datetime.strptime(date_slug.lower(), "%B-%d-%Y")
        except ValueError:
            continue
        return {
            "volume": int(volume),
            "issue": int(issue_num),
            "date": date,
            "base_url": f"https://www.ontario.ca/document/{slug}",
        }

    raise RuntimeError("Could not locate a Gazette issue link — check GAZETTE_SEARCH_URL markup")


def backfill_issue_bases(anchor: dict, weeks: int):
    """Yield (issue_num, date, issue_base_url) for the anchor issue and
    `weeks - 1` prior weekly issues, newest first."""
    for k in range(weeks):
        issue_num = anchor["issue"] - k
        if issue_num < 1:
            break
        date = anchor["date"] - timedelta(weeks=k)
        slug_date = f"{date.strftime('%B').lower()}-{date.day}-{date.year}"
        url = (
            f"https://www.ontario.ca/document/ontario-gazette-volume-"
            f"{anchor['volume']}-issue-{issue_num:02d}-{slug_date}"
        )
        yield issue_num, date, url


def find_issue_notice_urls(issue_base_url: str) -> list[str]:
    """Find every tax-arrears notice page (tender or auction, and any
    extra numbered pages of either) linked from an issue's own page."""
    try:
        resp = requests.get(issue_base_url, headers=HEADERS, timeout=30)
    except requests.RequestException as e:
        print(f"    could not reach issue page: {e}", file=sys.stderr)
        return []
    if resp.status_code == 404:
        return []
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    urls = set()
    for a in soup.find_all("a", href=True):
        href = a["href"]
        if re.search(r"sale-?s?-land-tax-arrears-public-(tender|auction)(-\d+)?/?$", href, re.IGNORECASE):
            full = href if href.startswith("http") else f"https://www.ontario.ca{href}"
            urls.add(full.rstrip("/"))

    if not urls:
        # Fallback if the issue page's markup doesn't expose a normal link
        # list: try the two standard sub-page URLs directly.
        for kind in ("tender", "auction"):
            candidate = f"{issue_base_url.rstrip('/')}/sale-land-tax-arrears-public-{kind}"
            try:
                check = requests.get(candidate, headers=HEADERS, timeout=30)
                if check.status_code == 200:
                    urls.add(candidate)
            except requests.RequestException:
                pass

    return sorted(urls)


def parse_notice_page(html: str) -> list[dict]:
    """Split a tax-arrears page into per-municipality notices, then
    per-property records within each notice.

    Works on the page's flattened text rather than its tag structure.
    Government CMS markup (permalink icons nested inside headings, wrapper
    divs, etc.) breaks tag-based matching in ways that are hard to predict
    in advance; matching on the text every notice is legally required to
    contain is far more durable.
    """
    soup = BeautifulSoup(html, "html.parser")
    content = soup.find("main") or soup
    full_text = content.get_text("\n", strip=True)

    # Every notice heading is "The Corporation of the <Town/Township/City/
    # Municipality/County> of <Name>" — required wording under O. Reg
    # 181/03. The same phrase also appears a second time near the bottom
    # of each notice, in the clerk's signature block, so matching the
    # phrase alone over-splits each notice in two. A real heading is
    # always immediately followed by "Take Notice" — the signature-block
    # mention isn't — so use that as the disambiguator.
    heading_re = re.compile(
        r"The Corporation of the (?:Town|Township|City|Municipality|County|Village)s? of [^\n]+"
    )
    heading_matches = [
        m
        for m in heading_re.finditer(full_text)
        if re.search(r"Take\s*Notice", full_text[m.end(): m.end() + 120], re.IGNORECASE)
    ]

    print(f"    found {len(heading_matches)} municipality headings", file=sys.stderr)
    if not heading_matches:
        print("    first 300 chars of page text:", file=sys.stderr)
        print("    " + full_text[:300], file=sys.stderr)
        return []

    records = []
    for i, m in enumerate(heading_matches):
        municipality = m.group(0).strip()
        block_start = m.end()
        block_end = heading_matches[i + 1].start() if i + 1 < len(heading_matches) else len(full_text)
        block_text = full_text[block_start:block_end]

        # Closing date/time: tenders close at a submission deadline;
        # auctions are held at a sale date/time. Try both phrasings.
        closing_match = re.search(
            r"(?:local time on|o.clock[^.]*?on the)\s+(?:the\s+)?"
            r"([A-Za-z]+\.?\s*\d{1,2}(?:st|nd|rd|th)?,?\s*\d{4}|"
            r"\d{1,2}(?:st|nd|rd|th)?\s+day\s+of\s+[A-Za-z]+,?\s*\d{4})",
            block_text,
            re.IGNORECASE,
        )
        closing_date = None
        if closing_match:
            raw = re.sub(r"(st|nd|rd|th)\b", "", closing_match.group(1))
            raw = re.sub(r"\s+day\s+of\s+", " ", raw).replace(",", "").strip()
            for fmt in ("%B %d %Y", "%d %B %Y"):
                try:
                    closing_date = datetime.strptime(raw, fmt).date().isoformat()
                    break
                except ValueError:
                    continue

        gazette_ref_match = re.search(r"\((\d+-P\d+)\)", block_text)
        gazette_ref = gazette_ref_match.group(1) if gazette_ref_match else None

        # Each property is introduced by "Roll No." somewhere before its
        # own "Minimum Tender Amount:" or "Minimum Bid" line. Government
        # pages often mark up "Roll No." with an accessibility abbreviation
        # tag, which splits "Roll" and "No." into separate text nodes once
        # flattened — so match across whitespace between the two words
        # rather than requiring them adjacent.
        property_chunks = re.split(r"(?=Roll\s+No)", block_text)
        for chunk in property_chunks:
            amount_match = re.search(
                r"(Minimum Tender Amount|Minimum Bid):?\s*(" + MONEY_RE + r")", chunk
            )
            if not amount_match:
                continue

            roll_match = re.search(
                r"Roll\s+No\.?\s*\(?Number\)?:?\s*([0-9][0-9 \-]*[0-9])", chunk
            )
            pin_match = re.search(r"\b(\d{5}[\-\u2013]\d{4})\b", chunk)
            assessed_match = re.search(
                r"assessed value of (?:the )?land(?:\(s\))? is:?\s*(" + MONEY_RE + r")", chunk
            )
            file_match = re.search(r"File No\.?\s*\(?Number\)?:?\s*([\w\-]+)", chunk)
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
                    "min_tender": parse_amount(amount_match.group(2)),
                    "file_no": file_match.group(1).strip() if file_match else None,
                    "closing_date": closing_date,
                    "gazette_ref": gazette_ref,
                    "scraped_at": datetime.now(timezone.utc).isoformat(),
                }
            )

    return records


def record_identity(r: dict):
    """A property's identity across repeated weekly reprints — never the
    Gazette reference, which is different every week even for the exact
    same sale."""
    if r.get("roll_no"):
        return ("roll", r["municipality"], r["roll_no"])
    if r.get("address"):
        return ("addr", r["municipality"], r["address"])
    return ("fallback", r["municipality"], r.get("min_tender"), r.get("closing_date"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default="listings.json", help="Output JSON path")
    parser.add_argument(
        "--weeks", type=int, default=1,
        help="How many past weekly issues to scan (1 = current issue only; ~13 = 3 months)",
    )
    parser.add_argument(
        "--url", help="Fetch one specific notice page directly instead of discovering issues"
    )
    args = parser.parse_args()

    all_records = []

    if args.url:
        sale_type = "auction" if "auction" in args.url.lower() else "tender"
        print(f"Fetching {args.url}", file=sys.stderr)
        resp = requests.get(args.url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        recs = parse_notice_page(resp.text)
        for r in recs:
            r["sale_type"] = sale_type
            r["source_url"] = args.url
            r["gazette_issue"] = 0
        all_records.extend(recs)
    else:
        anchor = find_latest_issue_anchor()
        print(
            f"Latest issue: Vol {anchor['volume']} Issue {anchor['issue']} "
            f"({anchor['date'].date()}) — scanning {args.weeks} week(s) back",
            file=sys.stderr,
        )
        for issue_num, date, issue_url in backfill_issue_bases(anchor, args.weeks):
            print(f"Issue {issue_num} ({date.date()}): {issue_url}", file=sys.stderr)
            notice_urls = find_issue_notice_urls(issue_url)
            if not notice_urls:
                print("  no tax-arrears notice pages found for this issue", file=sys.stderr)
                continue
            for notice_url in notice_urls:
                sale_type = "auction" if "auction" in notice_url.lower() else "tender"
                print(f"  [{sale_type}] {notice_url}", file=sys.stderr)
                try:
                    resp = requests.get(notice_url, headers=HEADERS, timeout=30)
                    resp.raise_for_status()
                except requests.RequestException as e:
                    print(f"    failed to fetch: {e}", file=sys.stderr)
                    continue
                recs = parse_notice_page(resp.text)
                for r in recs:
                    r["sale_type"] = sale_type
                    r["source_url"] = notice_url
                    r["gazette_issue"] = issue_num
                print(f"    parsed {len(recs)} property records", file=sys.stderr)
                all_records.extend(recs)
                time.sleep(1)  # be polite to ontario.ca

    # Oldest issue first, so a newer reprint of the same property
    # (possibly corrected or postponed) overwrites the older copy below.
    all_records.sort(key=lambda r: r.get("gazette_issue", 0))

    out_path = Path(args.out)
    existing = []
    if out_path.exists() and out_path.read_text().strip():
        try:
            existing = json.loads(out_path.read_text())
        except json.JSONDecodeError:
            print(
                f"WARNING: {out_path} exists but isn't valid JSON (empty or corrupted) — "
                "starting fresh instead of crashing.",
                file=sys.stderr,
            )
            existing = []

    merged = {record_identity(r): r for r in existing}
    added, updated = 0, 0
    for r in all_records:
        key = record_identity(r)
        if key in merged:
            updated += 1
        else:
            added += 1
        merged[key] = r  # newest data always wins for a given property

    # Drop anything already past its closing date — the register should
    # reflect what's actually still open, not a growing historical log.
    today = datetime.now().date().isoformat()
    before_count = len(merged)
    final = [
        r for r in merged.values()
        if not r.get("closing_date") or r["closing_date"] >= today
    ]
    dropped_closed = before_count - len(final)

    out_path.write_text(json.dumps(final, indent=2))
    print(
        f"{added} new, {updated} refreshed, {dropped_closed} closed listings dropped, "
        f"{len(final)} total open listings in {out_path}",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
