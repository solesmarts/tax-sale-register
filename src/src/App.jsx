import { useState, useMemo, useEffect } from "react";

// ---------------------------------------------------------------------------
// Live data comes from listings.json, kept current by a weekly scraper
// (see scrape_ontario_tax_sales.py) that reads The Ontario Gazette and
// commits the result to this repo. FALLBACK_LISTINGS below is a snapshot
// from Gazette Vol. 159, Issue 37 (Sept 10, 2026), shown only if the live
// feed can't be reached — Facts (roll no., PIN, assessed value, minimum
// tender, closing date, contact) are reproduced as public-record data; the
// notices themselves are government legal publications, not creative works.
// ---------------------------------------------------------------------------
const RAW_DATA_URL =
  "https://raw.githubusercontent.com/solesmarts/tax-sale-register/main/listings.json";

// Converts the scraper's snake_case JSON records into the shape this
// component uses. Live records don't carry a "region" or "contact" — those
// only exist on the fallback snapshot — so both are left undefined and the
// UI treats them as optional throughout.
const mapLiveRecord = (r, i) => ({
  id: `${r.gazette_ref || "live"}-${r.roll_no || r.min_tender || i}`,
  municipality: r.municipality,
  address: r.address || "Address in original notice",
  rollNo: r.roll_no,
  pin: r.pin,
  fileNo: r.file_no,
  assessedValue: r.assessed_value,
  minTender: r.min_tender,
  closingDate: r.closing_date,
  gazetteRef: r.gazette_ref,
  sourceUrl: r.source_url,
  scrapedAt: r.scraped_at,
});

const FALLBACK_LISTINGS = [
  {
    id: "159-P287-1",
    municipality: "Town of Kirkland Lake",
    region: "District of Timiskaming",
    address: "30 Main St., Kirkland Lake",
    rollNo: "54 68 000 005 01500 0000",
    pin: "61404-0101",
    fileNo: "23-07",
    assessedValue: 83000,
    minTender: 9509.92,
    closingDate: "2026-10-07",
    gazetteRef: "159-P287",
    contact: { name: "Darlene Peever, Tax Collector", phone: "705-567-9361 ext. 229", email: "Darlene.Peever@tkl.ca", site: "www.kirklandlake.ca" },
  },
  {
    id: "159-P288-1",
    municipality: "Township of Black River-Matheson",
    region: "District of Timiskaming",
    address: "715 Gleason Ave., Holtyre",
    rollNo: "56 14 000 012 14800 0000",
    pin: "65380-0284",
    fileNo: "24-27",
    assessedValue: 31000,
    minTender: 10825.13,
    closingDate: "2026-10-08",
    gazetteRef: "159-P288",
    contact: { name: "Patricia Murphy, Junior Accountant", phone: "705-273-2313 ext. 314", email: "pmurphy@twpbrm.ca", site: "www.twpbrm.ca" },
  },
  {
    id: "159-P288-2",
    municipality: "Township of Black River-Matheson",
    region: "District of Timiskaming",
    address: "647 Edward Ave., Val Gagne",
    rollNo: "56 14 000 012 23400 0000",
    pin: "65380-0147",
    fileNo: "24-28",
    assessedValue: 3100,
    minTender: 6894.37,
    closingDate: "2026-10-08",
    gazetteRef: "159-P288",
    contact: { name: "Patricia Murphy, Junior Accountant", phone: "705-273-2313 ext. 314", email: "pmurphy@twpbrm.ca", site: "www.twpbrm.ca" },
  },
  {
    id: "159-P288-3",
    municipality: "Township of Black River-Matheson",
    region: "District of Timiskaming",
    address: "649 Edward Ave., Val Gagne",
    rollNo: "56 14 000 012 23500 0000",
    pin: "65380-0148",
    fileNo: "24-29",
    assessedValue: 3100,
    minTender: 6789.28,
    closingDate: "2026-10-08",
    gazetteRef: "159-P288",
    contact: { name: "Patricia Murphy, Junior Accountant", phone: "705-273-2313 ext. 314", email: "pmurphy@twpbrm.ca", site: "www.twpbrm.ca" },
  },
  {
    id: "159-P288-4",
    municipality: "Township of Black River-Matheson",
    region: "District of Timiskaming",
    address: "651 Edward Ave., Val Gagne",
    rollNo: "56 14 000 012 23600 0000",
    pin: "65380-0149",
    fileNo: "24-30",
    assessedValue: 3100,
    minTender: 6743.92,
    closingDate: "2026-10-08",
    gazetteRef: "159-P288",
    contact: { name: "Patricia Murphy, Junior Accountant", phone: "705-273-2313 ext. 314", email: "pmurphy@twpbrm.ca", site: "www.twpbrm.ca" },
  },
  {
    id: "159-P289-1",
    municipality: "Township of Muskoka Lakes",
    region: "District Municipality of Muskoka",
    address: "Deewood Dr., Muskoka Lakes",
    rollNo: "44 53 020 017 06100 0000",
    pin: "48136-0350",
    fileNo: "24-09",
    assessedValue: 25500,
    minTender: 8680.44,
    closingDate: "2026-10-01",
    gazetteRef: "159-P289",
    contact: { name: "Tina Forsyth, Manager of Taxation", phone: "705-765-3156 ext. 220", email: "tforsyth@muskokalakes.ca", site: "www.muskokalakes.ca" },
  },
  {
    id: "159-P289-2",
    municipality: "Township of Muskoka Lakes",
    region: "District Municipality of Muskoka",
    address: "Peninsula Rd., Muskoka Lakes",
    rollNo: "44 53 040 018 00305 0000",
    pin: "48143-0488",
    fileNo: "24-17",
    assessedValue: 14100,
    minTender: 8569.22,
    closingDate: "2026-10-01",
    gazetteRef: "159-P289",
    contact: { name: "Tina Forsyth, Manager of Taxation", phone: "705-765-3156 ext. 220", email: "tforsyth@muskokalakes.ca", site: "www.muskokalakes.ca" },
  },
  {
    id: "159-P289-3",
    municipality: "Township of Muskoka Lakes",
    region: "District Municipality of Muskoka",
    address: "1034 Lidsley Rd., Gravenhurst",
    rollNo: "44 53 080 003 11600 0000",
    pin: "48033-0543",
    fileNo: "24-45",
    assessedValue: 930000,
    minTender: 48555.93,
    closingDate: "2026-10-01",
    gazetteRef: "159-P289",
    contact: { name: "Tina Forsyth, Manager of Taxation", phone: "705-765-3156 ext. 220", email: "tforsyth@muskokalakes.ca", site: "www.muskokalakes.ca" },
  },
  {
    id: "159-P290-1",
    municipality: "Town of Rainy River",
    region: "Rainy River District",
    address: "320 First St., Rainy River",
    rollNo: "59 42 000 000 35401 0000",
    pin: "56056-0063",
    fileNo: "25-01",
    assessedValue: 5800,
    minTender: 54676.92,
    closingDate: "2026-10-07",
    gazetteRef: "159-P290",
    contact: { name: "Shara Lavallee, CAO/Clerk-Treasurer", phone: "807-852-3978 ext. 24", email: "rrcao@tbaytel.net", site: "" },
  },
  {
    id: "159-P290-2",
    municipality: "Town of Rainy River",
    region: "Rainy River District",
    address: "601 Park St., Rainy River",
    rollNo: "59 42 000 000 52100 0000",
    pin: "56055-0880",
    fileNo: "25-02",
    assessedValue: 12800,
    minTender: 19531.32,
    closingDate: "2026-10-07",
    gazetteRef: "159-P290",
    contact: { name: "Shara Lavallee, CAO/Clerk-Treasurer", phone: "807-852-3978 ext. 24", email: "rrcao@tbaytel.net", site: "" },
  },
  {
    id: "159-P291-1",
    municipality: "Township of Sables-Spanish Rivers",
    region: "Algoma District",
    address: "290 Imperial St. N, Massey",
    rollNo: "52 18 000 008 06800 0000",
    pin: "73423-0431",
    fileNo: "24-02",
    assessedValue: 74000,
    minTender: 22713.34,
    closingDate: "2026-10-07",
    gazetteRef: "159-P291",
    contact: { name: "Ruth Clare, Treasurer", phone: "705-865-2646 ext. 225", email: "rclare@sables-spanish.ca", site: "" },
  },
  {
    id: "159-P291-2",
    municipality: "Township of Sables-Spanish Rivers",
    region: "Algoma District",
    address: "17 Young St., Webbwood",
    rollNo: "52 18 000 010 07900 0000",
    pin: "73413-0187",
    fileNo: "24-03",
    assessedValue: 9400,
    minTender: 63569.80,
    closingDate: "2026-10-07",
    gazetteRef: "159-P291",
    contact: { name: "Ruth Clare, Treasurer", phone: "705-865-2646 ext. 225", email: "rclare@sables-spanish.ca", site: "" },
  },
  {
    id: "159-P291-3",
    municipality: "Township of Sables-Spanish Rivers",
    region: "Algoma District",
    address: "2 Algoma St., Webbwood",
    rollNo: "52 18 000 010 18100 0000",
    pin: "73413-0062",
    fileNo: "24-05",
    assessedValue: 9300,
    minTender: 7835.44,
    closingDate: "2026-10-07",
    gazetteRef: "159-P291",
    contact: { name: "Ruth Clare, Treasurer", phone: "705-865-2646 ext. 225", email: "rclare@sables-spanish.ca", site: "" },
  },
  {
    id: "159-P292-1",
    municipality: "Town of Thessalon",
    region: "Algoma District",
    address: "234 Main St., Thessalon",
    rollNo: "57 28 000 003 03000 0000",
    pin: "31446-1033",
    fileNo: "25-03",
    assessedValue: 58000,
    minTender: 19261.56,
    closingDate: "2026-10-07",
    gazetteRef: "159-P292",
    contact: { name: "Debbie Rydall, Clerk-Treasurer", phone: "705-842-2217", email: "debbie@thessalon.ca", site: "www.thessalon.ca" },
  },
  {
    id: "159-P293-1",
    municipality: "Municipality of Chatham-Kent",
    region: "Chatham-Kent",
    address: "10 Lisa St., Wheatley",
    rollNo: "3650-020-001-50590",
    pin: "00837-0109",
    fileNo: "",
    assessedValue: 256000,
    minTender: 29302.65,
    closingDate: "2026-10-21",
    gazetteRef: "159-P293",
    contact: { name: "Amy McLellan / Matthew Torrance, Revenue", phone: "", email: "", site: "www.chatham-kent.ca" },
  },
  {
    id: "159-P293-2",
    municipality: "Municipality of Chatham-Kent",
    region: "Chatham-Kent",
    address: "11185 Vasik Line, Kent Bridge",
    rollNo: "3650-140-005-57500",
    pin: "00900-0015",
    fileNo: "",
    assessedValue: 1014000,
    minTender: 33253.95,
    closingDate: "2026-10-21",
    gazetteRef: "159-P293",
    contact: { name: "Amy McLellan / Matthew Torrance, Revenue", phone: "", email: "", site: "www.chatham-kent.ca" },
  },
  {
    id: "159-P293-3",
    municipality: "Municipality of Chatham-Kent",
    region: "Chatham-Kent",
    address: "91 Bayview Dr., Blenheim",
    rollNo: "3650-140-006-33400",
    pin: "00938-0808",
    fileNo: "",
    assessedValue: 111000,
    minTender: 15517.53,
    closingDate: "2026-10-21",
    gazetteRef: "159-P293",
    contact: { name: "Amy McLellan / Matthew Torrance, Revenue", phone: "", email: "", site: "www.chatham-kent.ca" },
  },
  {
    id: "159-P293-4",
    municipality: "Municipality of Chatham-Kent",
    region: "Chatham-Kent",
    address: "125 Oak St. W, Bothwell",
    rollNo: "3650-320-001-01300",
    pin: "00642-0103",
    fileNo: "",
    assessedValue: 32000,
    minTender: 33954.36,
    closingDate: "2026-10-21",
    gazetteRef: "159-P293",
    contact: { name: "Amy McLellan / Matthew Torrance, Revenue", phone: "", email: "", site: "www.chatham-kent.ca" },
  },
  {
    id: "159-P293-5",
    municipality: "Municipality of Chatham-Kent",
    region: "Chatham-Kent",
    address: "561 Robinson St., Dresden",
    rollNo: "3650-390-003-03000",
    pin: "00603-0148",
    fileNo: "",
    assessedValue: 34000,
    minTender: 9360.57,
    closingDate: "2026-10-21",
    gazetteRef: "159-P293",
    contact: { name: "Amy McLellan / Matthew Torrance, Revenue", phone: "", email: "", site: "www.chatham-kent.ca" },
  },
  {
    id: "159-P293-6",
    municipality: "Municipality of Chatham-Kent",
    region: "Chatham-Kent",
    address: "29615 St. Clair Pky, Wallaceburg",
    rollNo: "3650-410-010-06204",
    pin: "00586-0035",
    fileNo: "",
    assessedValue: 147000,
    minTender: 19020.41,
    closingDate: "2026-10-21",
    gazetteRef: "159-P293",
    contact: { name: "Amy McLellan / Matthew Torrance, Revenue", phone: "", email: "", site: "www.chatham-kent.ca" },
  },
  {
    id: "159-P293-7",
    municipality: "Municipality of Chatham-Kent",
    region: "Chatham-Kent",
    address: "Park Ave. W, Chatham",
    rollNo: "3650-420-017-16000",
    pin: "00517-0467",
    fileNo: "",
    assessedValue: 4000,
    minTender: 6886.91,
    closingDate: "2026-10-21",
    gazetteRef: "159-P293",
    contact: { name: "Amy McLellan / Matthew Torrance, Revenue", phone: "", email: "", site: "www.chatham-kent.ca" },
  },
  {
    id: "159-P293-8",
    municipality: "Municipality of Chatham-Kent",
    region: "Chatham-Kent",
    address: "217 Creek St., Wallaceburg",
    rollNo: "3650-442-001-12900",
    pin: "00567-0005",
    fileNo: "",
    assessedValue: 87000,
    minTender: 15606.99,
    closingDate: "2026-10-21",
    gazetteRef: "159-P293",
    contact: { name: "Amy McLellan / Matthew Torrance, Revenue", phone: "", email: "", site: "www.chatham-kent.ca" },
  },
];

const fmtMoney = (n) =>
  typeof n === "number"
    ? n.toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 })
    : "—";

const daysUntil = (iso) => {
  const ms = new Date(iso + "T15:00:00") - new Date();
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
};

const fmtDate = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });

export default function TaxSaleRegister() {
  const [query, setQuery] = useState("");
  const [municipality, setMunicipality] = useState("all");
  const [sort, setSort] = useState("closing");
  const [starredOnly, setStarredOnly] = useState(false);
  const [starred, setStarred] = useState(new Set());
  const [expanded, setExpanded] = useState(null);
  const [ready, setReady] = useState(false);
  const [listings, setListings] = useState(FALLBACK_LISTINGS);
  const [dataSource, setDataSource] = useState("loading"); // "loading" | "live" | "fallback"

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get("starred-listings", false);
        if (res && res.value) setStarred(new Set(JSON.parse(res.value)));
      } catch (e) {
        // no saved listings yet
      } finally {
        setReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(RAW_DATA_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await res.json();
        if (Array.isArray(raw) && raw.length > 0) {
          setListings(raw.map(mapLiveRecord));
          setDataSource("live");
        } else {
          setDataSource("fallback");
        }
      } catch (e) {
        setDataSource("fallback");
      }
    })();
  }, []);

  const toggleStar = async (id) => {
    const next = new Set(starred);
    next.has(id) ? next.delete(id) : next.add(id);
    setStarred(next);
    try {
      await window.storage.set("starred-listings", JSON.stringify([...next]), false);
    } catch (e) {
      // storage unavailable — state still updates for this session
    }
  };

  const municipalities = useMemo(
    () => ["all", ...new Set(listings.map((l) => l.municipality))],
    [listings]
  );

  const filtered = useMemo(() => {
    let rows = listings.filter((l) => {
      const q = query.trim().toLowerCase();
      const matchesQuery =
        !q ||
        (l.address || "").toLowerCase().includes(q) ||
        l.municipality.toLowerCase().includes(q);
      const matchesMunicipality = municipality === "all" || l.municipality === municipality;
      const matchesStar = !starredOnly || starred.has(l.id);
      return matchesQuery && matchesMunicipality && matchesStar;
    });
    rows.sort((a, b) => {
      if (sort === "closing") return new Date(a.closingDate) - new Date(b.closingDate);
      if (sort === "tender-asc") return a.minTender - b.minTender;
      if (sort === "tender-desc") return b.minTender - a.minTender;
      if (sort === "ratio")
        return b.assessedValue / b.minTender - a.assessedValue / a.minTender;
      return 0;
    });
    return rows;
  }, [listings, query, municipality, sort, starredOnly, starred]);

  return (
    <div style={styles.page}>
      <style>{css}</style>

      <header style={styles.masthead}>
        <div style={styles.mastheadInner}>
          <div style={styles.mastheadTitleRow}>
            <h1 style={styles.title}>Ontario Tax Sale Register</h1>
            <span style={styles.mastheadTag}>Municipal Act, 2001 — Part XI</span>
          </div>
          <p style={styles.subtitle}>
            Every active public-tender land sale from The Ontario Gazette, gathered into one
            searchable record. {listings.length} notices across {municipalities.length - 1}{" "}
            municipalities.
          </p>
          <p style={styles.dataSourceNote}>
            {dataSource === "loading" && "Loading the latest feed…"}
            {dataSource === "live" &&
              "Live feed — refreshed automatically every Saturday from The Ontario Gazette."}
            {dataSource === "fallback" &&
              "Showing a saved snapshot — the live feed couldn't be reached just now."}
          </p>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.toolbar}>
          <input
            style={styles.search}
            placeholder="Search by address or municipality…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            style={styles.select}
            value={municipality}
            onChange={(e) => setMunicipality(e.target.value)}
          >
            {municipalities.map((m) => (
              <option key={m} value={m}>
                {m === "all" ? "All municipalities" : m}
              </option>
            ))}
          </select>
          <select style={styles.select} value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="closing">Closing soonest</option>
            <option value="tender-asc">Minimum tender: low to high</option>
            <option value="tender-desc">Minimum tender: high to low</option>
            <option value="ratio">Assessed value vs. tender</option>
          </select>
          <button
            style={{ ...styles.starToggle, ...(starredOnly ? styles.starToggleActive : {}) }}
            onClick={() => setStarredOnly((v) => !v)}
          >
            {starredOnly ? "★ Watchlist" : "☆ Watchlist"}
          </button>
        </div>

        <div style={styles.resultCount}>
          {filtered.length} {filtered.length === 1 ? "notice" : "notices"}
          {starredOnly ? " on your watchlist" : ""}
        </div>

        {ready && filtered.length === 0 && (
          <div style={styles.empty}>
            {starredOnly
              ? "Nothing on your watchlist yet. Star a listing to track it here."
              : "No notices match that search. Try a different district or clear the search."}
          </div>
        )}

        <div style={styles.list}>
          {filtered.map((l) => {
            const days = daysUntil(l.closingDate);
            const ratio =
              typeof l.assessedValue === "number" && typeof l.minTender === "number"
                ? l.assessedValue / l.minTender
                : null;
            const isOpen = expanded === l.id;
            const isStarred = starred.has(l.id);
            return (
              <article key={l.id} style={styles.card}>
                <div style={styles.cardMain} onClick={() => setExpanded(isOpen ? null : l.id)}>
                  <button
                    style={styles.starBtn}
                    aria-label={isStarred ? "Remove from watchlist" : "Add to watchlist"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleStar(l.id);
                    }}
                  >
                    {isStarred ? "★" : "☆"}
                  </button>

                  <div style={styles.cardBody}>
                    <div style={styles.cardTopRow}>
                      <h2 style={styles.address}>{l.address}</h2>
                      <span
                        style={{
                          ...styles.dueBadge,
                          ...(days <= 10 ? styles.dueBadgeUrgent : {}),
                        }}
                      >
                        {days > 0 ? `closes in ${days}d` : "closed"} · {fmtDate(l.closingDate)}
                      </span>
                    </div>
                    <div style={styles.municipality}>{l.municipality}</div>
                    <div style={styles.figRow}>
                      <div>
                        <div style={styles.figLabel}>Minimum tender</div>
                        <div style={styles.figValue}>{fmtMoney(l.minTender)}</div>
                      </div>
                      <div>
                        <div style={styles.figLabel}>Assessed value</div>
                        <div style={styles.figValueMuted}>{fmtMoney(l.assessedValue)}</div>
                      </div>
                      <div>
                        <div style={styles.figLabel}>Assessed / tender</div>
                        <div style={styles.ratioValue}>{ratio ? `${ratio.toFixed(1)}×` : "—"}</div>
                      </div>
                    </div>
                  </div>
                </div>

                {isOpen && (
                  <div style={styles.expandPanel}>
                    <div style={styles.metaGrid}>
                      <div>
                        <span style={styles.metaLabel}>Roll No.</span>
                        <span style={styles.metaMono}>{l.rollNo}</span>
                      </div>
                      <div>
                        <span style={styles.metaLabel}>PIN</span>
                        <span style={styles.metaMono}>{l.pin}</span>
                      </div>
                      {l.fileNo && (
                        <div>
                          <span style={styles.metaLabel}>File No.</span>
                          <span style={styles.metaMono}>{l.fileNo}</span>
                        </div>
                      )}
                      <div>
                        <span style={styles.metaLabel}>Gazette ref.</span>
                        <span style={styles.metaMono}>{l.gazetteRef}</span>
                      </div>
                      <div>
                        <span style={styles.metaLabel}>Deposit required</span>
                        <span style={styles.metaMono}>20% of tender, certified</span>
                      </div>
                    </div>
                    <div style={styles.contactBlock}>
                      {l.contact ? (
                        <>
                          <div style={styles.metaLabel}>Contact for tender package</div>
                          <div style={styles.contactText}>
                            {l.contact.name}
                            {l.contact.phone ? ` · ${l.contact.phone}` : ""}
                            {l.contact.email ? ` · ${l.contact.email}` : ""}
                            {l.contact.site ? ` · ${l.contact.site}` : ""}
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={styles.metaLabel}>Tender package &amp; contact info</div>
                          <div style={styles.contactText}>
                            Not captured by the scraper — the full notice has the submission
                            address and contact.{" "}
                            {l.sourceUrl && (
                              <a
                                href={l.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={styles.sourceLink}
                                onClick={(e) => e.stopPropagation()}
                              >
                                View the original Gazette notice ↗
                              </a>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </main>

      <footer style={styles.footer}>
        This register aggregates public notices from The Ontario Gazette. It does not run any
        sale and makes no representation about title, condition, or value — confirm every detail
        with the listed municipality before tendering. Not legal, tax, or investment advice.
      </footer>
    </div>
  );
}

const css = `
  * { box-sizing: border-box; }
  article { transition: border-color 0.15s ease; }
  button { cursor: pointer; font-family: inherit; }
  input:focus, select:focus, button:focus-visible {
    outline: 2px solid #2F4B3C;
    outline-offset: 1px;
  }
  @media (max-width: 640px) {
    .figRowResponsive { flex-wrap: wrap; }
  }
`;

const styles = {
  page: {
    fontFamily: "ui-sans-serif, system-ui, 'Segoe UI', sans-serif",
    background: "#E7E3D6",
    color: "#20241F",
    minHeight: "100%",
    paddingBottom: "2rem",
  },
  masthead: {
    borderBottom: "3px double #2F4B3C",
    background: "#F8F6EF",
    padding: "1.75rem 1.25rem 1.5rem",
  },
  mastheadInner: { maxWidth: "760px", margin: "0 auto" },
  mastheadTitleRow: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "0.5rem",
    borderBottom: "1px solid #C9C2AC",
    paddingBottom: "0.6rem",
    marginBottom: "0.6rem",
  },
  title: {
    fontFamily: "Georgia, 'Iowan Old Style', 'Palatino Linotype', serif",
    fontSize: "1.6rem",
    fontWeight: 600,
    margin: 0,
    color: "#1E332A",
    letterSpacing: "0.2px",
  },
  mastheadTag: {
    fontSize: "0.72rem",
    color: "#6B6553",
    fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
  },
  subtitle: {
    fontSize: "0.9rem",
    lineHeight: 1.5,
    color: "#4A4F45",
    margin: 0,
    maxWidth: "62ch",
  },
  dataSourceNote: {
    fontSize: "0.72rem",
    color: "#6B6553",
    fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
    margin: "0.5rem 0 0",
  },
  main: { maxWidth: "760px", margin: "0 auto", padding: "1.25rem" },
  toolbar: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
    marginBottom: "0.75rem",
  },
  search: {
    flex: "1 1 220px",
    padding: "0.5rem 0.7rem",
    border: "1px solid #C9C2AC",
    background: "#FBF9F3",
    fontSize: "0.88rem",
    color: "#20241F",
  },
  select: {
    padding: "0.5rem 0.6rem",
    border: "1px solid #C9C2AC",
    background: "#FBF9F3",
    fontSize: "0.85rem",
    color: "#20241F",
  },
  starToggle: {
    padding: "0.5rem 0.8rem",
    border: "1px solid #C9C2AC",
    background: "#FBF9F3",
    fontSize: "0.85rem",
    color: "#4A4F45",
  },
  starToggleActive: {
    borderColor: "#9C6B30",
    color: "#9C6B30",
    background: "#F6EEE0",
  },
  resultCount: {
    fontSize: "0.78rem",
    color: "#6B6553",
    marginBottom: "0.75rem",
    fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
  },
  empty: {
    padding: "2rem 1rem",
    textAlign: "center",
    color: "#6B6553",
    border: "1px dashed #C9C2AC",
    background: "#F8F6EF",
    fontSize: "0.9rem",
  },
  list: { display: "flex", flexDirection: "column", gap: "0.65rem" },
  card: {
    background: "#FBF9F3",
    border: "1px solid #C9C2AC",
    borderLeft: "4px solid #2F4B3C",
  },
  cardMain: { display: "flex", padding: "0.85rem 1rem", cursor: "pointer" },
  starBtn: {
    border: "none",
    background: "none",
    fontSize: "1.15rem",
    color: "#9C6B30",
    lineHeight: 1,
    padding: "0 0.6rem 0 0",
    alignSelf: "flex-start",
  },
  cardBody: { flex: 1, minWidth: 0 },
  cardTopRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: "0.75rem",
    flexWrap: "wrap",
  },
  address: {
    fontFamily: "Georgia, 'Iowan Old Style', serif",
    fontSize: "1.05rem",
    margin: 0,
    color: "#1E332A",
  },
  dueBadge: {
    fontSize: "0.72rem",
    color: "#4A4F45",
    fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
    whiteSpace: "nowrap",
  },
  dueBadgeUrgent: { color: "#8B3A3A", fontWeight: 600 },
  municipality: { fontSize: "0.82rem", color: "#6B6553", marginTop: "0.15rem" },
  figRow: {
    display: "flex",
    gap: "1.75rem",
    marginTop: "0.65rem",
    flexWrap: "wrap",
  },
  figLabel: {
    fontSize: "0.68rem",
    color: "#6B6553",
    textTransform: "none",
  },
  figValue: {
    fontSize: "0.95rem",
    fontWeight: 600,
    color: "#1E332A",
    fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
  },
  figValueMuted: {
    fontSize: "0.95rem",
    color: "#4A4F45",
    fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
  },
  ratioValue: {
    fontSize: "0.95rem",
    fontWeight: 600,
    color: "#9C6B30",
    fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
  },
  expandPanel: {
    borderTop: "1px solid #C9C2AC",
    padding: "0.85rem 1rem 1rem 2.4rem",
    background: "#F4F1E6",
  },
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
    gap: "0.5rem 1rem",
    marginBottom: "0.7rem",
  },
  metaLabel: {
    display: "block",
    fontSize: "0.68rem",
    color: "#6B6553",
  },
  metaMono: {
    display: "block",
    fontSize: "0.82rem",
    fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
    color: "#20241F",
  },
  contactBlock: { paddingTop: "0.35rem", borderTop: "1px solid #C9C2AC" },
  contactText: { fontSize: "0.82rem", color: "#20241F", marginTop: "0.15rem" },
  sourceLink: { color: "#2F4B3C", fontWeight: 600 },
  footer: {
    maxWidth: "760px",
    margin: "1.5rem auto 0",
    padding: "0 1.25rem",
    fontSize: "0.75rem",
    color: "#6B6553",
    lineHeight: 1.5,
  },
};
