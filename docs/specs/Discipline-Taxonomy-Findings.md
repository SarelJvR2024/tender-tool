# Discipline taxonomy - findings (audit Q3) and SACNASP / SAGC registrations (audit Q5)

2026-10-17. Answers `Hardcoded-Assumptions-Audit.md` §7 Q3 and Q5 on Sarel's decisions.

Sarel on Q3: *"There is no standard list. We will have to build it as we get new tenders into the system. We will have to normalize the list and keep adding to it ... CIDB is only a small portion of the tenders that's going to be out there ... Let's rather build our own list ... it's a list that we're gonna have to maintain and build."*

Sarel on Q5: *"We can accommodate that into the structure, but don't specifically ask for it unless the tender requires it."*

Everything below was read from the sources named, on the date above. No list was taken from memory.

---

## 1. What other South African tender systems sort by

### 1.1 eTenders (National Treasury, www.etenders.gov.za)

**The public site's "Category" filter.** `Home/opportunities?id=1` has a `categorieslist` multi-select with **91 entries**. There are two families of entry:

- **Legacy "Services: / Supplies:" entries (15).** Services: Building / Civil / Electrical / Functional (Including Cleaning and Security Services) / General / Professional; Supplies: Clothing/Textiles/Footwear / Computer Equipment / Electrical Equipment / General / Medical / Perishable Provisions / Stationery/Printing; Disposals: General; Agricultural Products and Services.
- **Industry divisions (76).** These look like Stats SA's Standard Industrial Classification (ISIC-based), e.g. "Civil engineering", "Specialised construction activities", "Security and investigation activities", "Manufacture of furniture" and "Legal and accounting activities".

The **buyer** picks one entry per tender.

**How the buyers actually use it.** The site's own data endpoint (`Home/PaginatedTenderOpportunities`, the JSON behind the table) was read for every advertised tender on 2026-10-17: **2 211 tenders**, each with its `category`. The three largest entries are generic buckets:

| Buyer's own category | Tenders | What those tenders actually are (Tender Tool's taxonomy groups, §3) |
|---|---|---|
| Services: Professional | 292 | professional 108, financial/legal/business 44, IT 36, electrical/mechanical 31, training 30, buildings 28, ... |
| Services: General | 215 | electrical/mechanical 48, goods 45, security/facilities 39, buildings 35, professional 22, fleet 19, ... |
| Construction | 181 | buildings 68, roads/civil 63, electrical/mechanical 29, water 25, ... |
| Supplies: General | 145 | goods 127, electrical 32, security 16, fleet 12, buildings 12, ... |
| Other service activities | 142 | goods 37, training 22, fleet 21, electrical 17, ... |

Together, "Services: Professional", "Services: General" and "Supplies: General" are **29%** of all tenders. Each of those buckets spans a dozen unrelated trades. So **the buyer's own category can't be the taxonomy**. It is too coarse, and the same work is filed under different entries by different buyers. Examples:

- Security guarding appears under "Services: Functional", "Security and investigation activities", "Services: Professional" and "Other service activities".
- Office leases appear under "Rental and leasing", "Real estate" and "Accommodation".

It is still useful as a cross-reference. Every category in §3 records the eTenders entries it corresponds to (`etenders_categories`).

**The full dropdown with the live count per entry** (2 211 tenders, 2026-10-17):

Accommodation (55); Activities auxiliary to financial service and insurance activities. (6); Activities of head offices; management consultancy activities (28); Activities of households as employers of domestic personnel (0); Administrative and support activities (62); Advertising and market research (10); Agricultural Products and Services (8); Air transport (2); Architectural and engineering activities; technical testing and analysis (12); Arts, entertainment and recreation (1); Civil engineering (57); Computer programming, consultancy and related activities (12); Construction (181); Construction of buildings (35); Creative, arts and entertainment activities (3); Disposals: General (14); Education (17); Electricity, gas, steam and air conditioning (42); Employment activities (0); Financial and insurance activities (16); Financial service activities, except insurance and pension funding (21); Food and beverage service activities (21); Human health activities (10); Human health and social work activities (7); Information and communication (42); Information service activities (23); Insurance, reinsurance and pension funding, except compulsory social security (1); Land transport and transport via pipelines (7); Legal and accounting activities (10); Libraries, archives, museums and other cultural activities (3); Manufacture of basic metals (2); Manufacture of chemicals and chemical products (8); Manufacture of coke and refined petroleum products (1); Manufacture of computer, electronic and optical products (2); Manufacture of electrical equipment (9); Manufacture of fabricated metal products, except machinery and equipment (7); Manufacture of furniture (11); Manufacture of machinery and equipment n.e.c. (13); Manufacture of motor vehicles, trailers and semi-trailers (4); Manufacture of other non-metallic mineral products (0); Manufacture of paper and paper products (0); Manufacture of rubber and plastics products (1); Manufacture of textiles (0); Manufacturing (6); Mining and quarrying (3); Mining of coal and lignite (0); Mining support service activities (1); Motion picture, video and television programme production, sound recording and music publishing activities (1); Office administrative, office support and other business support activities (11); Other manufacturing (10); Other personal service activities (15); Other professional, scientific and technical activities (16); Other service activities (142); Postal and courier activities (1); Printing and reproduction of recorded media (1); Professional, scientific and technical activities (31); Programming and broadcasting activities (1); Publishing activities (0); Real estate activities (28); Remediation activities and other waste management services (4); Rental and leasing activities (84); Repair and installation of machinery and equipment (23); Residential care activities (0); Scientific research and development (4); Security and investigation activities (22); Services to buildings and landscape activities (14); Services: Building (31); Services: Civil (32); Services: Electrical (43); Services: Functional (Including Cleaning and Security Services) (72); Services: General (215); Services: Professional (292); Sewerage (4); Specialised construction activities (16); Sports activities and amusement and recreation activities (1); Supplies: Clothing/Textiles/Footwear (25); Supplies: Computer Equipment (21); Supplies: Electrical Equipment (43); Supplies: General (145); Supplies: Medical (17); Supplies: Perishable Provisions (3); Supplies: Stationery/Printing (12); Telecommunications (7); Transportation and storage (14); Travel agency, tour operator, reservation service and related activities (9); Warehousing and support activities for transportation (1); Waste collection, treatment and disposal activities; materials recovery (9); Water collection, treatment and supply (8); Water supply; sewerage, waste management and remediation activities (5); Water transport (0); Wholesale and retail trade and repair of motor vehicles and motorcycles (4)

**The OCDS open-data API (what Discovery reads, `ocds-api.etenders.gov.za`)** does **not** carry that category. 400 releases (2026-09-01 to 2026-10-16, pages that answered; the API 500s on some pages, as `etenders_national.py` already notes) give:

- **`mainProcurementCategory`:** services 205, *empty* 89, goods 59, works 47.
- **`additionalProcurementCategories`:** ["services"] 205, ["consultingServices"] 75, ["goods"] 59, ["works"] 47, [""] 14.

That is OCDS's own 4-value codelist, a procurement method rather than a discipline. 22% of releases leave it empty. It stays as `categorize()`'s fallback label (`uncategorized_goods` etc.), as before.

The OCDS tender `id` is the website's tender `id` (`ocds-9t57fa-174436` = site id 174436). So the buyer's site category *could* be joined onto each discovered tender. That is not done here; see open question O1.

### 1.2 Leads 2 Business (L2B)

- **Is it still running?** `leads2business.co.za` doesn't resolve. The company trades as **L2B** (`www.l2b.co.za`, HTTP 200). The 2026-10-17 strategy deep-dive (`250944d`) confirms it is still trading, with live 2026 pricing.
- **Where its categories are published:** its help wiki, `wiki.l2b.co.za/categories/` ("Tender Glossary"), read on 2026-10-17.
- **How L2B tags a tender:** "Category or Categories indicates the work required for the tender or project and we categorise according to what is mentioned in the title/description of the lead". That is the same approach as Tender Tool's keyword matching.

**L2B's 17 tender categories**, with its own keyword column:

| L2B category | L2B's "industry keyword" |
|---|---|
| Building | Building within the various Industry Sectors |
| Infrastructure | Infrastructure within the various Industry Sectors |
| Air Con & Refrigeration | Air conditioners, HVAC, cold rooms, server rooms |
| Alternate Energy | Solar, wind, Nuclear, Hydro, Gas, BESS |
| Consultants | Professional Services, Architects, Quantity Surveyors, consultants, feasibility studies, EIA |
| Demolition & Blasting | Demolition, blasting |
| Electrical & Instrumentation | Electrical reticulations, electrical repairs, transformers, control panels |
| Facilities Management | Cleaning, gardening, pest control, property management, landscaping, waste removal |
| Fencing | Fencing, palisade fencing, gates, electrified fencing |
| Fleet Management & Transportation | Supply/Lease vehicles, transport goods, vehicle tracking, vehicle maintenance, tyre repair |
| IT & Telecommunications | Computer hardware / software, PABX, VOIP, internet, Fibre optic, smart phones |
| Materials & Supplies | Supply of goods, furniture, tyres, building material |
| Mechanical | Valves, filters, screens. Mechanical installations |
| Plant & Machinery | Heavy & small plant, Yellow metal, machinery, excavators, TLB's, generators, compressors |
| Security & Fire | Security, guards, cash in transit, alarms, sprinkler systems, CCTV |
| Supplier Database | Register on supplier database |
| Trades | Plumbing, painting, tiling |

- **Industry sector field:** L2B also has a separate "Industry" field with 15 entries. These are where the work happens, not what it is: Factory & Warehousing, Healthcare, Hospitality & Leisure, Industrial, Institutional, Mining, Municipal, Office & Commercial, Power Grid, Renovations, Residential, Retail, Road, Transport Terminal, Water.
- **Project categories:** "Building & Infrastructure".
- **What L2B's list doesn't cover:** it is built for construction and facilities. It has no place for the large non-construction share of eTenders, such as training, audit/finance, legal, events/catering/travel, marketing/printing, health/social and property leases.
- **What this pass took from it:**
  - its useful splits: Fencing, Demolition, Plant & Machinery vs Fleet, Air Con, Alternate Energy, Security & Fire, Supplier Database;
  - its keywords, used as seeds.
- **Recorded per category:** `l2b_categories`.

### 1.3 CIDB classes of construction works (the audit's original Q3 suggestion)

Sarel rejected CIDB as the taxonomy: it covers construction works only. In the live sample, works (eTenders "Construction", "Civil engineering", "Construction of buildings", "Specialised construction activities", "Services: Building/Civil/Electrical") are roughly 400 of 2 211 tenders (18%). CIDB codes are kept as a **cross-reference** on the works categories (`cidb_classes`: CE, GB, EB, EP, ME and the S* specialist classes). They are not the list.

---

## 2. What the tenders already in this project actually are

| Source | What it contains | Categories it falls into (new taxonomy) |
|---|---|---|
| The 6 SANRAL samples (`seed_tenders.sql`: R.334, R.343, R.352 x2, R.394, R.396) | Each is "Consulting engineering services for the routine ad-hoc maintenance of R*** Section *" | `road_maintenance` + `consulting_engineering`. One also gets `dams_irrigation` because its route runs to "Glen Melville **Dam**" (a place name, see §4 limits) |
| The 11 general samples (`templates/general_samples/sources.json`) | Internal-audit training, fuel-tank panel, plumbing flush, employee wellness, e-library subscription, change management, alarm monitoring, guarding, thermocouples, lifeguards, architectural PSP | `training_skills_development`, `mechanical_plant_equipment` / `goods_supplies` / `disposals_auctions`, `plumbing`, `wellness_counselling`, `books_publications_subscriptions`, `management_consulting`, `security_guarding`, `security_guarding`, `mechanical_plant_equipment`, `facilities_management`, `architecture` + `building_maintenance_renovation` |
| Same 11 under the **old 7 buckets** | | 8 of 11 **uncategorized**. RAF plumbing went to `roads_civil` (from "**Road** Accident Fund"). The architectural PSP went to `it_telecoms` because "district" contains the substring "ict" |
| 400 OCDS releases (fetched again here; the award-outcomes pass's 800 aren't kept on disk) | | Old 7 buckets: **70.8% uncategorized**. New: 2.8% uncategorized, 93.2% a specific discipline, 4% a group only |
| 2 211 live eTenders tenders (§1.1) | | Old 7 buckets: **66.1% uncategorized**. New: **2.9% uncategorized**, 93.3% a specific discipline, 3.8% a group only |

**Precision, hand-checked.** A random 50 of the 2 211 was drawn, before the last round of keyword fixes:

- **Fully right:** 30.
- **Main discipline right, plus an extra wrong tag:** 11. These come mostly from a place or buyer name ("Mthatha **Dam**", "**Rand Water** ... Scientific Services", a lodge "in the Kruger").
- **Wrong:** 3: a mobile fire-fighter vehicle at a dam, a youth driver's-licence programme read as software, pauper burials left at group level.
- **Uncategorised:** 6.

The 3 wrong ones and several of the extra tags were then fixed. They are now regression cases in `engine/discovery/test_taxonomy.py`. So this is keyword matching, good enough to sort and to shortlist. It is not a substitute for reading the tender. See §4.

---

## 3. The taxonomy built: Tender Tool's own, maintained list

**19 groups and 93 disciplines** (112 categories), seeded from §1-§2.

**How the list was built.** It was grown in passes over the 2 211 live tenders:

1. Draft the groups and disciplines.
2. Run `taxonomy.py coverage` on the real tenders.
3. Read what stayed uncategorised and the most common words in it.
4. Read random matches for false positives.
5. Add or adjust keywords, excludes and vetoes.
6. Repeat.

**The groups:**

- **The 7 original buckets are kept as 7 of the group slugs:** `roads_civil`, `water`, `buildings`, `electrical_mechanical`, `it_telecoms`, `professional_services`, `security_facilities`. Every stored experience tag, `price_sector` and `discovered_opportunities.categories` value written before this pass is still a valid category.
- **The 12 new groups** cover what the live feed is mostly made of: goods, fleet/plant, health/social, training, financial/legal/business, events/catering/travel, marketing/printing, waste/environment, agriculture/forestry, property/leasing/disposals, mining/industrial and supplier-database notices.

| Group (slug) | Disciplines in it (live tenders matched, of 2 211) | eTenders categories it corresponds to | L2B category |
|---|---|---|---|
| **Roads, bridges & civil works** (`roads_civil`) - one of the original 7 | Road construction & upgrading (127), Road maintenance (potholes, reseal, gravel, markings) (65), Bridges & civil structures (8), Stormwater & drainage (21), Rail infrastructure (12), Ports, harbours & marine works (10), Earthworks, bulk & township services (11) | Civil engineering; Services: Civil | Infrastructure |
| **Water & sanitation** (`water`) - one of the original 7 | Water supply, pipelines & reticulation (30), Water & wastewater treatment, sewer & pump stations (90), Boreholes & groundwater (11), Dams, weirs & irrigation (34), Water meters, meter reading & water loss (10) | Water collection, treatment and supply; Water supply; sewerage, waste management and remediation activities; Sewerage | Infrastructure |
| **Building works & property maintenance** (`buildings`) - one of the original 7 | New buildings, schools, clinics & housing (100), Building repairs, renovation & maintenance (162), Plumbing (14), Demolition & blasting (1), Fencing & gates (22), Sports, parks & recreation facilities (10) | Construction; Construction of buildings; Services: Building | Building, Trades |
| **Electrical, mechanical & energy** (`electrical_mechanical`) - one of the original 7 | Electrical installation, reticulation & street lighting (141), Solar, renewable energy & energy efficiency (25), Generators & backup power (UPS) (21), HVAC, air conditioning & refrigeration (26), Mechanical plant, pumps, valves & industrial equipment (211) | Services: Electrical; Electricity, gas, steam and air conditioning; Repair and installation of machinery and equipment | Electrical & Instrument, Mechanical |
| **IT & telecoms** (`it_telecoms`) - one of the original 7 | Software, systems & licences (137), Computers, laptops, servers & IT hardware (36), Networks, connectivity & telecoms (52), Cybersecurity & information security (12), IT support & managed services (15) | Information and communication; Computer programming, consultancy and related activities; Information service activities; Telecommunications ... | IT & Telecom |
| **Professional & consulting services** (`professional_services`) - one of the original 7 | Consulting engineering (design & supervision) (61), Architecture (9), Quantity surveying & cost management (2), Project, programme & construction management (22), Town planning, land use & urban design (23), Environmental assessment & compliance (28), Geotechnical, geological & materials testing (3), Transport planning & traffic engineering (3), Land surveying, GIS & mapping (9), Property valuation (14), Feasibility, research, studies & advisory (41), Management consulting, strategy & organisational development (44), Laboratory, testing & scientific services (46) | Services: Professional; Professional, scientific and technical activities; Other professional, scientific and technical activities; Architectural and engineering activities; technical testing and analysis ... | Consultants |
| **Security, cleaning & facilities services** (`security_facilities`) - one of the original 7 | Security guarding & response (55), CCTV, access control & alarm systems (22), Fire protection & suppression (13), Cleaning & hygiene services (66), Pest control & fumigation (10), Gardening, landscaping & vegetation control (34), Facilities & property management (26) | Services: Functional (Including Cleaning and Security Services); Security and investigation activities; Services to buildings and landscape activities | Security & Fire, Facilities Management |
| **Goods & supplies** (`goods_supplies`) | Stationery & office supplies (15), Furniture & fittings (30), Uniforms, protective clothing & PPE (41), Building materials, hardware & stores stock (107), Fuel, lubricants & gas (31), Chemicals & treatment chemicals (17), Food, groceries & provisions (10), Appliances, tools & general equipment (12), Firearms, ammunition & policing equipment (3), Books, publications & subscriptions (4) | Supplies: General; Wholesale and retail trade and repair of motor vehicles and motorcycles; Manufacturing; Other manufacturing | Materials & Supplies |
| **Fleet, transport & plant** (`fleet_transport_plant`) | Vehicles & fleet management (51), Vehicle maintenance, tyres & repairs (7), Plant hire & yellow machinery (17), Transport, logistics, courier & removals (47), Aviation & marine transport (9) | Transportation and storage; Land transport and transport via pipelines; Wholesale and retail trade and repair of motor vehicles and motorcycles; Manufacture of motor vehicles, trailers and semi-trailers ... | Fleet Management & Transportation, Plant & Machinery |
| **Health, medical & social services** (`health_social`) | Medical supplies, pharmaceuticals & equipment (18), Health & occupational health services (21), Employee wellness, counselling & EAP (13), Social, community & care services (16), Animal care, pound & veterinary services (12) | Human health activities; Human health and social work activities; Supplies: Medical; Residential care activities | - |
| **Training, education & skills development** (`training_education`) | Training, learnerships & skills development (103), Education services, assessment & e-learning (29) | Education | - |
| **Financial, legal & business services** (`business_financial_legal`) | Audit, accounting & financial management (51), Banking, insurance & investment (39), Legal & investigation services (35), HR, recruitment & staffing (11), Records, archiving & document management (14), Admin support, data capturing & call centres (6) | Financial and insurance activities; Financial service activities, except insurance and pension funding; Legal and accounting activities; Administrative and support activities ... | - |
| **Events, catering, accommodation & travel** (`events_hospitality_travel`) | Catering & food services (27), Accommodation & conference venues (21), Travel management (12), Events, conferences & exhibitions (36), Arts, culture, heritage & sport programmes (20) | Accommodation; Food and beverage service activities; Travel agency, tour operator, reservation service and related activities; Arts, entertainment and recreation ... | - |
| **Marketing, media, communications & printing** (`marketing_media_printing`) | Advertising, marketing & public relations (19), Printing, publishing & design (15), Video, photography, audio-visual & broadcast (9), Signage, promotional items & branded goods (9) | Advertising and market research; Printing and reproduction of recorded media; Publishing activities; Programming and broadcasting activities ... | - |
| **Waste & environmental management** (`waste_environment`) | Waste collection, recycling & landfill (36), Environmental rehabilitation, alien clearing & fire breaks (9) | Waste collection, treatment and disposal activities; materials recovery; Remediation activities and other waste management services; Water supply; sewerage, waste management and remediation activities | Facilities Management |
| **Agriculture, forestry & food production** (`agriculture_forestry`) | Agriculture, farming & agro-processing (39), Forestry & timber resources (10) | Agricultural Products and Services | - |
| **Property, leasing & disposals** (`property_leasing_disposals`) | Office accommodation, leasing & property (163), Disposals, auctions & scrap sales (17) | Real estate activities; Rental and leasing activities; Disposals: General | - |
| **Mining, quarrying & industrial services** (`mining_industrial`) | Mining, quarrying & mine rehabilitation (14), Manufacturing & industrial production (36) | Mining and quarrying; Mining of coal and lignite; Mining support service activities; Manufacture of basic metals | - |
| **Supplier database & panel registration notices** (`supplier_database_notices`) | - | - | Supplier Database |

(Counts are of the 2 211 live tenders. A tender can be in several disciplines: a WWTW upgrade is water treatment, mechanical and electrical.)

### 3.1 How it grows without a migration

- **The live list is a table, `discipline_categories` (migration `0040`), not a CHECK list.** Adding a category is one INSERT:
  - `python3 engine/discovery/taxonomy.py add --slug hydrographic_survey --label "Hydrographic & bathymetric survey" --parent professional_services --keywords "hydrographic survey*, bathymetric*" [--write-seed]`;
  - or SQL as the service role.
  - It is the same idea as 0036, which opened `experience_items.disciplines`. Here the suggested list itself is open too.
- **Columns:**
  - `slug` (format-checked);
  - `label`;
  - `parent_slug` (null = group; two levels, enforced by a trigger);
  - `keywords` and `exclude_keywords` (what `categorize()` matches);
  - `etenders_categories`, `l2b_categories`, `cidb_classes` (the cross-references);
  - `active` (retire a category without breaking stored tags);
  - `added_from` (provenance).
- **Who reads it:** every signed-in user (RLS `select`). Only the service role writes it, like `tender_roles` (0016).
- **Who uses it:**
  - **Engine.** `taxonomy.active()` loads the live table once per process whenever the service-role env is present: the Discovery cron, the bridge worker and the intake. So a category inserted today is used on the next run with no deploy. Without the env, or if the table can't be read, it falls back to `config/discipline_taxonomy.json` (the reviewed seed, also shipped in the worker image) and says so in `.source`.
  - **App.** `app/lib/disciplineTaxonomy.ts loadDisciplineTaxonomy()` reads the same table for:
    - Experience Library suggestions (grouped checkboxes);
    - experience filter chips;
    - Discovery category labels;
    - the pricing sector select (optgroups);
    - the pricing history's group-by-sector.
- **`tender_packs.price_sector`** (0034 CHECK of the 7 keys) now references `discipline_categories(slug)` (FK, `on update cascade`). Any listed category, including one added later, is a valid sector. An unlisted one is refused.
- **A group stands for every discipline in it.**
  - A company tagged `roads_civil` matches a `road_maintenance` tender.
  - A tender check for roads_civil experience counts an item tagged `road_maintenance` (`expandDisciplines()` in the SANRAL compliance check and the Experience filter).
  - A company tagged only with a discipline gets a **"same discipline group - check scope"** reason when a tender is known only at group level. The verdict is `possible`, never `strong_fit`.
  - Siblings (architecture vs geotechnical) don't match.
- **The review loop Sarel described ("keep reviewing and adding"):**
  - `python3 engine/discovery/taxonomy.py coverage <releases.json>` takes a Discovery report, raw OCDS or the eTenders site rows. It prints the share sorted, tenders per category, the most common words in the uncategorised ones and the uncategorised tenders themselves. Those are the candidates for a new category or keyword.
  - `check` validates the seed.
  - `sync` pushes a reviewed seed edit to the table.
  - `sql` prints the seed as INSERTs (what 0040 carries).
  - Companies can still add their **own** tags (0036). They are kept and filterable. Adding the same slug to the list later makes it a listed category with no data change.

### 3.2 Matching rules (`taxonomy.py Taxonomy.match`)

- **Text is normalised:** lower-case, with punctuation turned into spaces ("air-conditioning" = "air conditioning").
- **Keywords match whole words**, so "district" no longer contains "ict". A trailing s/es plural matches too.
- **Keyword syntax:**
  - `*` = any ending ("geohydrolog*");
  - `a & b` = both present ("school & construct*": a school named as the *site* of a solar install is not school building work);
  - an exclude phrase is cut out before that category is tried ("road accident fund", "re-advert");
  - an exclude starting with `!` vetoes the category ("!lease the premises": a lease of premises at "Ocean Road" is not road work).
- **Output:** a specific discipline wins over its own group. A group appears alone only when its own generic keywords matched ("civil works", "supply and delivery").
- **The fallback is unchanged:** nothing matched → `uncategorized_<OCDS category>`.

### 3.3 What changed in the fit scoring (`assess_tender.assess_fit`)

Same verdicts and the same rules. Only "is this our discipline" is now `Taxonomy.overlap()` (exact / group / broad) instead of exact equality on 7 keys. Reasons name the discipline in words ("Discipline match: Security guarding & response (security_guarding) is within scope."). `test_discovery_fanout.py` gives the same verdicts as before (guarding company strong fit, architects not a fit, no-disciplines needs review).

---

## 4. Limits, stated

- **Keyword matching on title + description reads names as well as work.** A place, a buyer or a site can add a wrong extra tag: "Glen Melville **Dam**", "Rand **Water** Scientific Services", "Department of **Agriculture**". Buyer-name excludes catch the common ones. The rest show up as extra tags, not missing ones. The fit verdict only needs one of a company's disciplines to match. An extra tag can make a tender look relevant to one more company. It can't hide a real match.
- **3% of live tenders are still uncategorised**, mostly one-off wording ("Grid Forming Technologies", "Taxidermy services", account-verification services). They keep the `uncategorized_<kind>` label and `needs_review`, as before. `coverage` lists them for the next review.
- **The list is a starting point from one day's feed (2026-10-17).** Seasonal or rare kinds of tender (e.g. specific medical equipment, aviation, marine) are thin. The review loop above is how they get added.

---

## 5. Q5: SACNASP and SAGC registrations

**What the real tender says.** R.396-010-2025/1F Book 2/3 C3.1.11 (C3-14/C3-15, pdftotext of the on-disk PDF):

- Surveyor: 5 years, "Member of SAGC" (footnote 7: "South African Geomatics Council (SAGC)").
- Engineering Geologist: "Pr Sci.Nat", 5 years, SAIEG (footnote 5: "Registered with the South African Council for Natural Scientific Professions (SACNASP)").
- Elsewhere: "surveyors who are suitably registered in terms of the Geomatics Profession Act, Act 19 of 2013".

**The 11 general samples:** none ask for either body. They were checked with the new `find_person_registrations()` through `general_harness.py`: 44 manifests, 0 with `person_registrations`.

**Built (migration `0040`):**

- **`people` gets 6 new columns:** `sacnasp_category`, `sacnasp_number`, `sacnasp_expiry`, `sagc_category`, `sagc_number`, `sagc_expiry`.
  - Same shape as ECSA/SACPCMP (0001/0035): a free-text category like `ecsa_level`, the number, and the lapse/renewal date as on the certificate.
  - All nullable with no default, so they are never required.
- **Reminders.** `watch_deadlines.TRACKED_PERSON_EXPIRY_FIELDS` gains `sacnasp_expiry` and `sagc_expiry`. That is the same `find_due_person_credentials()` → `_expiry_window()` path as ECSA/SACPCMP: one seen-store, the 60-day window, re-reported once it lapses, and cv_admin digest routing. `daily_digest --mode local` picks them up from the same list.
- **People page: conditional, not on every person.**
  - `app/lib/personCredentials.ts registrationsAskedFor()` reads each **open** tender's own requirements:
    - SANRAL: `tender_requirements.position_description` naming an Engineering Geologist → SACNASP, a (non-quantity) Surveyor → SAGC;
    - general tenders: `tenders.document_requirements.person_registrations`, which `requirements.py find_person_registrations()` now writes when the documents require SACNASP / Pr.Sci.Nat / SAGC / PLATO / Professional Land Surveyor in context (glossary lines skipped).
  - A body's fields show only when the person already holds it, or when a tender asks for it. The tender is named: "Asked for by R.396-010-2025/1F (DS2)".
  - Otherwise they sit inside a **closed** "+ Add another registration (SACNASP, SAGC) - only some tenders ask for these" disclosure, so they can still be entered.
  - The People list chips and badges come from `credentialExpiries()`, which skips a body the person doesn't hold.
- **Compliance check.** `tenderCompliance.minimumRequirementFor()`:
  - For an **Engineering Geologist** position: SACNASP fields, Pr Sci.Nat category, number, and expiry valid on the closing date. A Cand./Cert.Sci.Nat category fails. Pr.Sci.Nat in the old ECSA text still counts.
  - For a **Surveyor** position: SAGC number and expiry at closing.
  - These fields are never read for any other position.
  - The general workspace gets a "Professional registrations this tender asks for" row per required body. It lists who holds it and whether it lapses before closing, with the tender's own quote.

**Real-document check:** `find_person_registrations()` on the real R.396 Book 2/3 text finds both: SACNASP (2 mentions) and SAGC (5).

**What R.396 actually tenders:** its SETUP positions are PL and DS1 Pavement, so no Geologist or Surveyor key position. That is why neither field is asked for on the People page for the six SANRAL samples. A tender with a geologist position (DS2 "Engineering Geologist" in the UI test) does trigger it.

---

## 6. Verification (this pass)

| Check | Result |
|---|---|
| `taxonomy.py check` | 112 categories (19 groups, 93 disciplines), 0 problems |
| `test_taxonomy.py`, Part 1 (no DB) | 39 PASS, 0 failures: 22 real descriptions in the expected disciplines (incl. the two old false positives fixed); group/broad/sibling overlap; assess_fit verdicts; a category that exists only as a table **row** is used at once; unreadable table → seed |
| `test_taxonomy.py`, Part 2 (fresh `0001`→`0040` replay, Postgres 16) | 11 PASS: 112 seed rows; INSERT adds a category; third level and bad slug refused; `authenticated` reads but can't write; `price_sector` accepts `roads_civil`, a new discipline and a category inserted a moment earlier, and refuses `bogus_sector`; `categorize()` reads the live table and uses the new row |
| `test_watch_conditional_registrations.py` | Part 1 (in-memory) and Part 2 (real rows on the replay, read through a psql-backed stand-in for the two PostgREST GETs): SACNASP expiring in 15 days → renew soon (person, company, number); SAGC lapsed 2 days ago → expired; an ECSA-only person → nothing, and gets nulls; second run → nothing new; cv_admin digest carries both. 0 failures |
| UI, real PostgREST 12.2.3 + RLS on a replay, `next dev`, a signed-in member's cookie | See the breakdown below |
| `test_discovery_fanout.py` (Part 1 + Part 2 on a fresh replay) | 0 failures, same verdicts as before |
| `test_manual_intake.py` (fresh UTF-8 replay `0001`→`0040`) | 0 failures |
| `general_harness.py --no-pack` | 44 clean, 0 flagged, 0 failed |
| Other tests | `test_general_bridge.py` ALL PASSED; `test_award_outcomes.py` ALL PASSED; `test_watch_person_credentials.py` and `test_watch_deadlines_urgency.py` 0 failures |
| `tsc --noEmit`, `eslint` | Clean |

**The UI checks in detail:**

- **No asking tender, no registration:** the SACNASP/SAGC inputs exist only inside the closed disclosure; ECSA is visible.
- **Gina holds SACNASP:** her SACNASP block is visible with "Renew soon", and SAGC stays in the disclosure. On the People list, Gina's chip reads "SACNASP renew by 01 Nov 2026", and Pat has no SACNASP/SAGC chip.
- **After an open general tender asking for SAGC and a R.396 "DS2 - Engineering Geologist" position are added:** Pat's page shows both blocks, "Asked for by R.396-010-2025/1F (DS2)" and "Asked for by UI/SURVEY/2026". The disclosure is gone. The real PostgREST embedding and the JSON filter both worked.
- **R.396 compliance:**
  - Gina on DS2: "minimum met: SACNASP Pr.Sci.Nat 400123/08, valid until 11/1/2026 - covers the closing date (renew soon)".
  - A geologist whose SACNASP lapses 19 Oct: "minimum not met: SACNASP registration expires 10/19/2026, before this tender closes".
  - A surveyor with SAGC on file: only the graduation date unknown.
  - Company experience: 1 qualifying, from an item tagged `road_maintenance` counted as roads_civil (exact matching on `roads_civil` would count 0).
- **Experience pages:** the detail page shows 19 group disclosures (only the ticked group open) and the item's own tag. `?discipline=roads_civil` lists the `road_maintenance` item, not the buildings one.
- **Pricing and RLS:** the pricing page has 19 optgroups. A member PATCHes `sagc_*` on their own person; another company's member updates 0 rows and sees none.

---

## 7. Open questions for Sarel (new)

- **O1 - use the buyer's own eTenders category too?** The site's `PaginatedTenderOpportunities` JSON carries each tender's category, and its `id` joins the OCDS release. Discovery deliberately uses only the OCDS open-data API ("not a scrape"). Reading the site's JSON as well would give the buyer's own category next to Tender Tool's, as a second signal and an extra review aid. Worth doing, or keep to the open-data API only?
- **O2 - who adds categories?** Built: service role (`taxonomy.py add` / `sync`, or SQL), as for the role catalog. Should there be an in-app admin screen? And should a company's own custom tag (0036) be offered for promotion to the shared list?
- **O3 - SACNASP/SAGC on the SANRAL forms.** The workbook's Form B1 has ECSA/SACPCMP registration cells only. Where a tender with a geologist or surveyor position wants the SACNASP/SAGC number printed (and on which form), nothing writes it yet. A real such tender would settle it (relates to audit Q2).
- **O4 - the other bodies.** SACAP, SACPLAN, SACQSP, SACPVP and PSIRA are still not person fields (Gap #3 / CV-extraction other_registrations). The conditional mechanism built here is the pattern to add them the same way: shown only when a tender asks. Do it for those too?
- **O5 - per-tender C3.1.11 extraction** (the other half of audit Q5). Not done: the Geologist/Surveyor/ECSA minimums still come from R.396's table, labelled as such, and are triggered by the position's own SETUP description.
