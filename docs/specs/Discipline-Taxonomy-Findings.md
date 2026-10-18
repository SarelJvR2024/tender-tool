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

- **O1 - use the buyer's own eTenders category too?** *Answered 2026-10-18 (Sarel: yes, as a cross-reference) - built, §8.1.* The site's `PaginatedTenderOpportunities` JSON carries each tender's category, and its `id` joins the OCDS release. Discovery deliberately uses only the OCDS open-data API ("not a scrape"). Reading the site's JSON as well would give the buyer's own category next to Tender Tool's, as a second signal and an extra review aid. Worth doing, or keep to the open-data API only?
- **O2 - who adds categories?** *Answered 2026-10-18 (Sarel: an in-app screen; companies may suggest, Sarel reviews) - built, §8.2.* Built: service role (`taxonomy.py add` / `sync`, or SQL), as for the role catalog. Should there be an in-app admin screen? And should a company's own custom tag (0036) be offered for promotion to the shared list?
- **O3 - SACNASP/SAGC on the SANRAL forms.** *Still open.* The workbook's Form B1 has ECSA/SACPCMP registration cells only. Where a tender with a geologist or surveyor position wants the SACNASP/SAGC number printed (and on which form), nothing writes it yet. A real such tender would settle it (relates to audit Q2).
- **O4 - the other bodies.** *Answered 2026-10-18 (Sarel: yes, same pattern) - built on the 0050 registrations catalog, §8.3.* SACAP, SACPLAN, SACQSP, SACPVP and PSIRA are still not person fields (Gap #3 / CV-extraction other_registrations). The conditional mechanism built here is the pattern to add them the same way: shown only when a tender asks. Do it for those too?
- **O5 - per-tender C3.1.11 extraction** *Answered 2026-10-18 (Sarel: "rest of Q5: build it") - built, §8.4.* (the other half of audit Q5). Not done: the Geologist/Surveyor/ECSA minimums still come from R.396's table, labelled as such, and are triggered by the position's own SETUP description.

---

## 8. Sarel's answers to O1, O2, O4 and O5 (2026-10-18) - built and verified

Migration `0054_taxonomy_admin_and_etenders_category.sql` (`0044`-`0053` are on `main` or claimed by other passes). Everything below was run against real data on the date given; nothing was taken from memory.

### 8.1 O1 - the buyer's own eTenders category, next to Tender Tool's (cross-reference only)

**Built.**

- `engine/discovery/etenders_national.py`:
  - `fetch_site_categories()` reads the site's own table data (`Home/PaginatedTenderOpportunities`, status 1 = advertised) once per run, 500 rows a page, each page retried once and then skipped. Only `category` / `categoriesID` are kept - the rows' contact names and e-mails are dropped.
  - `site_id_of()` joins on the ocid's numeric suffix (`ocds-9t57fa-174436` = site id `174436`); `attach_site_categories()` sets `etenders_category` (None when not read - never guessed). `--no-site-categories` turns it off.
- `taxonomy.Taxonomy.etenders_crosscheck(categories, site_category)` compares the buyer's entry with each category's own `etenders` cross-reference list: **agrees** (one of the tender's categories, or its group, lists it), **differs** (it corresponds to other categories, named), **generic** (one of the four catch-all buckets: Services: Professional / Services: General / Supplies: General / Other service activities), **unmapped** (no category lists it yet).
- `assess_tender.read_release()` / `score_release()` carry `etenders_category` + `etenders_category_check` next to `categories`. **`assess_fit()` never reads them** - the verdict is unchanged.
- Since the parallel government-coverage pass (`924813b`) Discovery reads the eTenders portal's own lists (`etenders_portal.py`); each portal release now carries `etenders_category` straight from its row, so no second read is needed. `watch_new_tenders.py` fetches the site list separately only for eTenders releases without it (an `--sources ocds` run); `seed_supabase_opportunities.py` writes the two new columns `discovered_opportunities.etenders_category` / `etenders_category_check` (0054).
- Discovery page: "Buyer's eTenders category: X" with a chip (agrees / differs - check / catch-all bucket / not cross-referenced yet), and for a "differs" the categories it corresponds to on Tender Tool's list.

**Verified against the live site (2026-10-18).**

| Run | Result |
|---|---|
| Live OCDS releases, last 3 days (300; the API 500'd on page 4, as `fetch_releases` already handles) joined to the live site (2 211 rows) | **295 of 300 (98.3%)** matched a site category. Cross-check: agrees 151, generic 87, differs 57 |
| All 2 211 advertised site tenders (description + the buyer's category) | agrees **1 212 (54.8%)**, generic **557 (25.2%)**, differs **442 (20.0%)**, unmapped **0**. Of the 66 Tender Tool can't categorise, 33 get a "differs" hint from the buyer's entry, 33 sit in a catch-all bucket |

Hand-check of 15 random "differs": Tender Tool's own reading was the better one in about 10 (fresh meat filed as "Food and beverage service activities", a legal panel as "Other personal service activities", auctioneers as "Financial service activities", a borehole as "Manufacture of fabricated metal products"); the buyer's entry added something real in about 3 (an Eskom land acquisition Tender Tool left uncategorised -> "Real estate activities"; optical assistive devices read only as goods -> "Supplies: Medical"); the rest are judgement calls. So a "differs" is a review prompt, not a correction - which is why it never changes the verdict.

Tests: `test_taxonomy.py` Part 1 - five real live tenders give agrees / agrees / differs / differs / generic; a "differs" names the matching categories (optical devices -> `medical_supplies_equipment`); uncategorised + a site category -> a hint; unknown entry -> unmapped; no site category -> no cross-check; `read_release`/`score_release` carry it and leave `categories` unchanged.

### 8.2 O2 - an admin screen for the list, and company suggestions Sarel reviews

**Who may write:** a **platform admin** (0043 `platform_admins` / `is_platform_admin()` - Tender Tool's own staff, not any company owner; the same rule 0043 put on `/admin`). 0054 adds insert/update policies on `discipline_categories` for them only. No delete for anyone but the service role (retire with `active = false`), and a new trigger stops a group that has disciplines being moved under another group (no third level).

**`/admin/taxonomy`** (linked from `/admin`, Civic Navy, inline styles):
- the whole list by group, each category editable (label, group, keywords, excludes, eTenders cross-references, active), with "no keywords - Discovery never sorts into it" flagged;
- "Add a category" (slug, label, group, keywords, excludes, provenance note, eTenders entries) - the same as `taxonomy.py add`; Discovery uses it on its next run;
- "Suggested by companies": pending suggestions with the company, the project it was used on and its note; **Approve** (label, group, keywords, a note) or **Reject** (a note shown to the company);
- read-only for everyone who isn't a platform admin.

**Suggestions** (`discipline_category_suggestions`, 0054): on an Experience Library item, each of the company's **own** tags (not on the list) gets "Suggest this as a shared category" (name, best-guess group, what it covers). It files a **pending** row - nothing is added to the list. The page says the reviewer sees the company name, tag, note and project name; the trigger snapshots those two names (a platform admin can't read another company's rows under RLS). `approve_discipline_suggestion()` creates the category **under the same slug** in one transaction, so the company's tagged items become a listed category with no change to their data. A member can withdraw a pending one; can't suggest for another company, point at another company's item, re-suggest a listed slug, file it as approved, or approve.

**Verified.**
- `test_taxonomy.py` Part 3 on a fresh replay (`0001` -> `0054`): 27 checks (87 in the whole file, 0 failures) - an owner can't add or edit; the admin adds, renames, retires; the third-level and no-delete rules; a member's pending suggestion with the snapshots; duplicate / other-company / other-company-item / listed-slug / pre-approved suggestions refused; company B doesn't see A's; the member can't approve directly or via the function; the admin approves (category created, same slug, note), A's item is then under a listed category, approving twice refused; `categorize()` sorts a "Bathymetric survey" tender into the approved category; reject with a note the company sees; review can't rewrite what was suggested; withdraw only while pending; deleting the example item keeps the suggestion.
- **End to end in a browser** (Playwright + `next dev` + real PostgREST 12.2.3 + RLS on a replay, signed-in cookies for a company owner and a platform admin): 23 of 23 checks - see §8.5.

### 8.3 O4 - SACAP, SACPLAN, SACQSP, SACPVP and PSIRA, only when a tender asks

**On the shared registrations catalog, not new columns.** A parallel pass (migration `0050`, `Company-Master-Data-List.md` §9.2) landed `registration_types` + `held_registrations` with all five bodies (person-scoped; PSIRA both), with expiry reminders through `registration_reminders.py` -> `watch_deadlines._expiry_window()`. So this pass adds **no `people` columns** for them (an earlier draft did; dropped before merge - one home per fact) and wires the SACNASP/SAGC conditional pattern to the catalog:

- **What a tender asks for** (`app/lib/personCredentials.ts registrationsAskedFor()`): a SANRAL position whose own SETUP description names the profession (quantity surveyor -> SACQSP, architect -> SACAP (not landscape), planner -> SACPLAN, valuer -> SACPVP, security officer/guard -> PSIRA), or a general tender's `document_requirements.person_registrations`, which `requirements.py find_person_registrations()` now fills for these five too (acronym, council name, the Act or the registered title, in a requirement context).
- **Definitions are not asks.** A council *named* in a definitions clause or a statute table ("statutory council: a) South African Council for the Architectural Profession, established by the Architectural Profession Act ..." - CDC44126's gazette annexure) is skipped unless a requirement verb sits next to it. This removed exactly 2 false positives in the corpus (SACAP and SACPVP in t033) and nothing else, for SACNASP/SAGC too.
- **People page:** an "Other registrations a tender asks for" card appears only for a body an open tender asks for (naming the tender: "Asked for by N.011-010-2027-1F (DS4)") or one the person already holds; it lists their catalog entries with the same expiry badge and adds one (`held_registrations`, `person_id`) in place. No asking tender, nothing held -> no card. `/company/registrations` remains where every type is managed.
- **Compliance check** (`tenderCompliance.ts`): a position whose requirement names one of the five reads the person's `held_registrations` of that type (the longest-valid one): none -> confirm ("it appears on the People page because this tender asks for it"); lapses before closing -> not met. Never read for any other position.
- **General workspace:** "Professional registrations this tender asks for" lists holders from the columns (SACNASP/SAGC) or the catalog (the five; for PSIRA the company or a director too).
- **Reminders:** unchanged - the catalog's own (`test_principals_registrations.py` on the 0054 replay: a person-held PSIRA 45 days out -> renew soon; 0 failures).

**Real tenders that ask** (the 123-tender hand-read corpus, `find_person_registrations()` after this change): SACAP 2 (ACSA COR8138 "registered in the relevant Built Environment Councils - (SACPCMP; SACAP; SACQSP; ECSA)"; DLRRD NC 001 "such as UDISA or SACAP"), SACPLAN 2 (DLRRD NC 001 "registered with the South African Council for Planners (SACPLAN) as a Professional Planner"; Mossel Bay TDR11 "Registration with SACPLAN carrying a weight of 30 points"), SACQSP 2 (ACSA COR8138; SANRAL N.011-010-2027-1F C3.1.11 QS row), SACPVP 1 (Maluti TVET "a Professional Valuer registered with the SACPVP"), PSIRA 6 (t012 CTICC CCTV/access control "must be PSIRA registered", t016 CoCT 99S urban CCTV, t032 EC Agriculture guarding, t086 a security-provider annexure asking for the PSIRA number and letter of good standing, t089 RAF "Security Officers must be PSIRA registered", t102 an asset-in-transit RFP). All hand-checked as real asks. Caveat: in most of the PSIRA tenders the ask is (also) the **company's** PSIRA registration, which the catalog holds at company level; the People card still appears for them because the people who guard need it too.

**The registration tested end to end:** SACQSP, against the real N.011-010-2027-1F C3.1.11 table (a Quantity Surveyor position, DS4): the People card appears only for that reason, the registration is added there into `held_registrations`, and the tender's compliance report fails the minimum because it lapses before closing (§8.5).

### 8.4 O5 - each tender's own C3.1.11 minimum-requirements table

**Built:** `engine/discovery/key_person_minimums.py extract_key_person_minimums(text)` - the same precedent as `score_outlook.extract_experience_evidence()`: read the tender's own stated rule; never fall back inside the extractor. It finds C3.1.11 "Personnel requirements" -> "d) Minimum requirements", measures the table's columns from its header (again after each page break, where the header repeats with a different indent), and places each multi-line cell on its row by the row's anchor line (its years cell - SANRAL's cells are vertically centred on it). Per row: the position (and SANRAL code PL/APL/DS/ADS/CE/ACE/RE/ARE, or a specialist kind), the qualification/registration cell verbatim, a registration code (`pr_eng`, `pr_eng_or_tech`, `pr_techni_eng`, `candidate`, `pr_sci_nat`, `sagc`, `sacqsp`, `sacpcmp`, ..., `qualification`, `refer`), bodies, years (`10`, `<10` -> under 10, `5-10`, `10-15`), the "Other requirements" cell, and alternatives (Senior Materials Technician: none/20, ND/10, Pr Techni Eng/5). Whatever can't be placed is reported (`unparsed`), not guessed.

It is stored on `tenders.evaluation_rules.key_person_minimums` (jsonb - no migration) by `seed_tender_evaluation_rules.py` (now `--document` once per book: Book 1 for the experience rule, Book 2/3 for C3.1.11; its broken import of the removed `supabase_request` was fixed) and by the manual-load intake (`requirements.py` manifest -> `process_general_jobs.py`).

**What the two real tables say** (the only two SANRAL Book 2/3s in the corpus; verbatim excerpts committed as `engine/discovery/fixtures/c3111/`):

| Position | R.396-010-2025/1F | N.011-010-2027-1F |
|---|---|---|
| Project Leader | Pr Eng or Pr Tech Eng, 10 | same, 10 - "In the permanent employment of the tendering entity" (no "or Targeted Enterprise") |
| Contract Engineer | Pr Eng or Pr Tech Eng, 10 | **Pr Eng** (only), 10 |
| Engineer's Representative | Pr Eng or Pr Tech Eng, **5** | Pr Eng or Pr Tech Eng, **10-15** |
| Assistant RE | Registered Candidate, **2** | Candidate Technician to Pr Eng, **5** |
| Quantity Surveyor | (no row) | Registered Professional / Technologist / Technician QS, 5, **SACQSP** |
| Surveyor / Eng. Geologist / OHS / RSA Team Leader / Programmer / Materials technicians / Trainee | identical in both | |

(The real R.396 table's footnote numbers are off by one - "SAGC6" while footnote 6 is SACPCMP - so bodies are read from the text, not the footnote numbers.)

**The compliance report** (`tenderCompliance.ts minimumRequirementFor/checkMinimumRequirement`, `compliance-data.ts`, `compliance-report.tsx`): uses THIS tender's row when its table was read (matched by the position's own description for a specialist - geologist, surveyor, quantity surveyor - else by code), "Also required by the table (not checked from records): ..." for the other-requirements cell, alternatives met when any one is; and only when the tender's table hasn't been read (or has no row for that position) R.396's table, with an amber **"Assumed rule - this tender's own C3.1.11 minimum-requirements table hasn't been read"** banner and "Assumed rule - needs: ..." on each such position - the same pattern as the experience-evidence fallback.

**Verified.**
- `test_key_person_minimums.py`: 36 checks - every row of both real tables cell by cell, the R.396/N.011 differences, 4 no-table texts -> not_found, and the full R.396 Book 2/3 PDF (when on disk) reads the same 17 rows as its excerpt.
- Corpus: 137 texts (123 hand-read tenders + the six SANRAL Book 1s + others): a table found only in N.011's Books 2&3 (correct - every other document has none); the SANRAL Book 1s -> not_found, so for the five seeded SANRAL tenders without their Book 2/3 the fallback banner applies.
- `seed_tender_evaluation_rules.py` dry run on R.396 Book 1 + Book 2/3: the experience rule plus 17 C3.1.11 rows.
- Compliance logic (jiti on the TS module, N.011's table): a Pr Tech Eng fails N.011's Contract Engineer minimum but meets R.396's (assumed); an RE with 7 years fails N.011's 10 but meets R.396's 5; QS with no SACQSP -> confirm, valid -> met, lapsing before closing -> not met; the PL employment requirement is named, not judged; a position missing from the tender's table falls back with source "assumed"; 11/11.
- In the browser (§8.5).

### 8.5 End-to-end browser check (2026-10-18)

Playwright (Chromium) + `next dev` + real PostgREST 12.2.3 + RLS on a fresh replay of `0001` -> `0054` + `seed_tenders.sql`; signed-in cookies for a company owner and a platform admin. **23 of 23 passed:**

1. Owner: `/admin/taxonomy` read-only, no Admin tab.
2. Owner: an experience item tagged with the own tag `hydrographic_survey` offers the suggestion; sent -> "Suggested - waiting for review"; one pending row with the company + project snapshot; **not** on the list.
3. Platform admin: has the Admin tab; sees the suggestion with company and project; adds `heritage_conservation` (row checked in the DB); approves the suggestion with keywords and a note (category created under the same slug, suggestion approved); retires `heritage_conservation` from its edit form (`active = false`).
4. Owner: the item's tag now shows as a listed discipline; the own-tag card is gone.
5. Owner, People: Quinton (assigned to N.011's DS4 "Quantity Surveyor") shows the SACQSP card "Asked for by N.011-010-2027-1F (DS4)" and no SACAP/PSIRA/SACPLAN/SACPVP card; adding SACQSP there writes `held_registrations` (catalog) and shows "Renew soon".
6. N.011 compliance report: "Minimum requirements read from this tender's own C3.1.11 table"; the Contract Engineer (a Pr Tech Eng) fails the tender's own "Pr Eng"; DS4's SACQSP lapses before closing -> not met. The seeded R.396 (no table read): the amber "Assumed rule" banner and "Assumed rule - needs: ..." per position.

### 8.6 New open questions

- **N1 - PSIRA at company level in the general checklist.** Most PSIRA asks are for the company's registration; the catalog holds it (scope both), but the general workspace's returnables checklist doesn't yet say "on file" from it (same gap as `Company-Master-Data-List.md` §9.4).
- **N2 - first platform admin.** Like `/admin` since 0043, the screen needs Sarel's account in `platform_admins` once (SQL editor). Should onboarding of Tender Tool staff get its own small screen?
- **N3 - the C3.1.11 table of the other five seeded SANRAL tenders.** Only R.396's Book 2/3 is on disk; R.334, R.343, R.352 x2 and R.394 show the "Assumed rule" banner until their Book 2/3 is run through `seed_tender_evaluation_rules.py` (or uploaded through the manual load).
- **N4 - "Other requirements" are named, not checked** (permanent employment, SAIEG membership, the road-safety course and two audits). Employment is on the person (0036 `employment_status`) - worth checking the "permanent employment of the tendering entity" cell against it?
- **N5 - catalog bodies in the SANRAL C3.1.11 fallback.** R.396's table has no QS row, so without a tender table a QS position is checked only for SACQSP registration (years not assumed) - fine, but say so if a different default is wanted.
