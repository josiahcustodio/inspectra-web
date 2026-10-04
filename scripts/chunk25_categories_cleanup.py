"""
chunk25_categories_cleanup.py

Reshapes the Firestore `categories` and `checklist_templates` collections of
project `inspectra-firebase` so they match the authoritative paper source,
`checklists.xlsx`, which is the set of forms an inspector actually carries.

WHY THIS EXISTS
---------------
The original seed was wrong in two ways that both bite the Chunk 3 picker:

  1. Two of the three live category NAMES do not describe their own templates.
     Item-for-item against the xlsx, category '2' ("Water") is really the
     SUPERMARKETS form and category '3' ("Institutional") is really the
     PUBLIC PLACES form. No inspection has ever used either one (every
     historical result row resolves to category '1' templates), so the names
     can be corrected without rewriting any history.
  2. Seven of the ten categories are duplicate "Food" rows. Six are orphans and
     get deleted; '9' is held back because 14 establishments still point at it
     (see CHUNK25_HOLD_NINE).

The xlsx carries ten checklist blocks; only three were ever seeded. This script
adds the missing six as real categories with 20 templates each, plus Livestock
Farm as a deliberately empty category (its block in the source has a header and
no items yet).

Deliberately OUT OF SCOPE: `establishments` and `inspection_logs`. This script
never writes to them - that is a later session. See ALLOWED_COLLECTIONS, which
is asserted before the batch commits.

HOW TO RUN
----------
    # read-only: prints every precondition, the full per-document diff, exits 0
    python "chunk25_categories_cleanup.py"

    # the real thing - writes to PRODUCTION Firestore in ONE atomic batch
    python "chunk25_categories_cleanup.py" --apply

    # optional, off by default: also delete the held-back category '9'
    python "chunk25_categories_cleanup.py" --apply --delete-nine

    # non-default credential / source document
    python "chunk25_categories_cleanup.py" --key C:\\path\\serviceAccountKey.json
    python "chunk25_categories_cleanup.py" --xlsx C:\\path\\checklists.xlsx

Dry run is the default. Nothing is written without --apply.

IDEMPOTENCE
-----------
This script is NOT idempotent and is not meant to be: a second --apply run
fails the precondition gate (categories '11'..'17' and templates '101'..'220'
will already exist, and the 10-doc/60-doc counts will no longer hold) and exits
non-zero before touching anything. That is the intended protection against a
double run - re-running can never duplicate or re-rename data. If you genuinely
need to re-run, the live data has to be restored to the pre-migration shape
first.

Every applied operation is appended to chunk25_cleanup.log next to this script,
following the precedent of bin/admin_actions.log in the mobile repo.
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys

try:
    import openpyxl
    from openpyxl.utils import get_column_letter
except ImportError:
    print("Error: 'openpyxl' package not found.")
    print("Install it by running: pip install openpyxl")
    sys.exit(2)


# =============================================================================
# CONFIGURATION
# =============================================================================

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(SCRIPT_DIR, "chunk25_cleanup.log")

DEFAULT_KEY_PATH = (
    r"C:\Users\josia\Downloads\Inspectra\Inspectra Firebase"
    r"\clowtec_inspector\serviceAccountKey.json"
)
DEFAULT_XLSX_PATH = r"C:\Users\josia\Downloads\Inspectra\checklists.xlsx"

EXPECTED_PROJECT_ID = "inspectra-firebase"
SHEET_NAME = "Sheet1"

CATEGORIES = "categories"
TEMPLATES = "checklist_templates"

# A write to anything outside this set is a bug, not a decision. `establishments`
# and `inspection_logs` belong to a later chunk and must survive this one
# untouched; the batch builder asserts against this set before committing.
ALLOWED_COLLECTIONS = frozenset({CATEGORIES, TEMPLATES})

# Every live template carries weight 5, and 20 items x 5 = 100, which is what
# the demerit scoring in the mobile app assumes. New rows must match.
TEMPLATE_WEIGHT = 5

# None of the six new blocks has a sub-category column in the source document,
# so every new template lands in the same bucket the live 'General' rows use.
DEFAULT_SUB_CATEGORY = "General"

# ---- Flagged additions beyond the chunk's original spec ---------------------

# [REF: CHUNK25_SORT_ORDER]
# Addition beyond the original Chunk 2.5 spec. `useCollection` in the web admin
# issues no orderBy, so Firestore hands back documents in doc-id ascending
# order: '11' sorts before '2' and the officer's category picker ends up in an
# order nobody chose. Rather than leave display order to id luck - the exact
# class of bug this chunk exists to remove - every surviving category gets an
# explicit integer. Nothing reads it yet (`mapCategory` drops unknown fields);
# it is groundwork for the Chunk 3 picker. Spacing of 10 leaves room to insert a
# new form type later without renumbering anything.
ADD_SORT_ORDER = True

# Addition beyond the original spec, cosmetic by design. `category` on a
# template is a denormalized copy of the category name. After the renames, ids
# '61'..'80' would still claim 'Water' while sitting on a Supermarkets
# checklist, and '41'..'60' would claim 'Institutional' on a Public Places one -
# a statement that is simply false inside a government audit store. Nothing
# reads the field (`mapChecklistTemplate` ignores it, and the Flutter
# offline_service overwrites it from the categories map on every sync), so this
# buys honesty on disk, not behaviour.
FIX_TEMPLATE_CATEGORY_STRING = True


# =============================================================================
# MEASURED LIVE STATE - the preconditions assert exactly this
# =============================================================================

EXPECTED_LIVE_CATEGORIES = {
    "1": "Food",
    "2": "Water",
    "3": "Institutional",
    "4": "Food",
    "5": "Food",
    "6": "Food",
    "7": "Food",
    "8": "Food",
    "9": "Food",
    "10": "Food",
}

EXPECTED_TEMPLATE_FIELDS = frozenset(
    {"category", "category_id", "item_name", "sub_category", "weight"}
)

# (first id, last id inclusive, category_id every doc in the band must carry)
EXPECTED_TEMPLATE_BANDS = (
    (1, 20, "1"),    # Food
    (41, 60, "3"),   # really Public Places
    (61, 80, "2"),   # really Supermarkets
)

# [REF: CHUNK25_ID_ALLOCATION]
# Ids '21'..'40' are VACANT in the live collection - almost certainly the
# templates of a category somebody deleted. Reusing that band would silently
# resurrect a dead numbering and make any old export or log line that mentions
# template '27' ambiguous forever, so new rows start at '101' instead, well
# clear of it. The allocation is also meaningful: the i'th item of a block (1-
# based) lands on id base+(i-1), in source order, so the printed order of an
# inspection form is recoverable from the ids alone without an extra sort field.
VACANT_TEMPLATE_BAND = (21, 40)
NEW_TEMPLATE_BAND = (101, 233)


# =============================================================================
# THE PLAN
# =============================================================================

# id -> (name now, name after). Correcting a name that never described its own
# templates; both are unreferenced by any inspection.
CATEGORY_RENAMES = {
    "2": ("Water", "Supermarkets"),
    "3": ("Institutional", "Public Places"),
}

# Orphan duplicate-'Food' categories. Verified unreferenced: live
# establishments.category_id holds only '9', int 1, '1' and null, and
# checklist_templates.category_id holds only '1', '2', '3'.
CATEGORY_DELETIONS = ("4", "5", "6", "7", "8", "10")

# [REF: CHUNK25_HOLD_NINE]
# '9' is a duplicate 'Food' row exactly like the six above, but 14 of the 21
# establishments still carry category_id '9'. Deleting it now would leave the
# web admin's category dropdown (AddEstablishmentModal.tsx) with nothing
# selected the moment an officer opens any of those 14 for editing, and
# repointing establishments is a later session's scope. So it stays, parked at
# sort_order 999 so it sinks to the bottom of the picker, and removal is a
# deliberate human act behind --delete-nine.
HELD_BACK_CATEGORY_ID = "9"

# New categories. The `name` values are human-reviewed DISPLAY names, not raw
# xlsx titles: the source sheet shouts in caps, writes 'CONDOMINUM', and uses
# singular 'APARTMENT'/'MOTELS' inconsistently. The titles below are what an
# officer should read in the picker; `xlsx_title` is the key used to find the
# matching block in the source document, and that one is verbatim.
NEW_CATEGORIES = (
    {
        "id": "11",
        "name": "Swimming Pool and Bathhouse",
        "xlsx_title": "SANITARY  INSPECTION OF SWIMMING POOL AND BATHHOUSE PLACES",
        "first_template_id": 101,
        "item_count": 20,
    },
    {
        "id": "12",
        "name": "Laundry Establishments",
        "xlsx_title": "SANITARY INSPECTION OF LAUNDRY ESTABLISHMENTS",
        "first_template_id": 121,
        "item_count": 20,
    },
    {
        "id": "13",
        "name": "Hotels, Motels, Apartments, Condominiums and Transient Houses",
        "xlsx_title": (
            "SANITARY INSPECTION OF HOTELS, MOTELS, APARTMENT, "
            "CONDOMINUM & TRANSIENT HOUSE"
        ),
        "first_template_id": 141,
        "item_count": 20,
    },
    {
        "id": "14",
        "name": "Vessel",
        "xlsx_title": "SANITARY INSPECTION OF VESSEL",
        "first_template_id": 161,
        "item_count": 20,
    },
    {
        "id": "15",
        "name": "Port",
        "xlsx_title": "SANITARY INSPECTION OF PORT",
        "first_template_id": 181,
        "item_count": 20,
    },
    {
        "id": "16",
        "name": "Day Care, Pre-School Services and Children's Institution",
        "xlsx_title": (
            "SANITARY INSPECTION OF DAY CARE, PRE-SCHOOL SERVICES "
            "AND CHILDREN'S INSTITUTION"
        ),
        "first_template_id": 201,
        "item_count": 20,
    },
    {
        # [REF: CHUNK25_LIVESTOCK_MODEL]
        # The only COMPLIANT-scored form in the document, and the only one whose
        # items carry sub-fields. Seeded as its 13 numbered items, because the
        # COMPLIANT ( / ) column is ruled against those numbered rows - the 38
        # fill-in lines under them are the evidence an inspector writes to
        # justify each mark, not separately scored items.
        #
        # weight 0, not 5: no demerit weighting has ever been published for this
        # form. Inventing one to make 13 items reach 100 would be fabricating
        # regulatory data. The consequence is disclosed by report_livestock_model()
        # - until a per-category scoring mode exists, a completed livestock
        # inspection displays 100.
        "id": "17",
        "name": "Livestock Farm",
        "xlsx_title": "LIVESTOCK FARM SANITARY INSPECTION CHECKLIST",
        "first_template_id": 221,
        "item_count": 13,
        "weight": 0,
    },
)

# Display order for the Chunk 3 picker: the three high-volume forms first, then
# the rest roughly by how often Batangas City inspects them, with the held-back
# duplicate last.
SORT_ORDERS = {
    "1": 10,    # Food
    "2": 20,    # Supermarkets
    "12": 30,   # Laundry Establishments
    "13": 40,   # Hotels, Motels, ...
    "11": 50,   # Swimming Pool and Bathhouse
    "3": 60,    # Public Places
    "16": 70,   # Day Care, ...
    "14": 80,   # Vessel
    "15": 90,   # Port
    "17": 100,  # Livestock Farm
    HELD_BACK_CATEGORY_ID: 999,
}

# Existing templates whose denormalized `category` string goes stale the moment
# the renames land. category_id / item_name / sub_category / weight are already
# correct on these and must not move.
TEMPLATE_CATEGORY_STRING_FIXES = (
    (41, 60, "Institutional", "Public Places"),
    (61, 80, "Water", "Supermarkets"),
)

# ---- Source-document typos -------------------------------------------------
#
# These are HUMAN-REVIEWED, verbatim-in-the-source defects. They are written to
# Firestore exactly as the paper form reads them, because an inspector ticking a
# printed checklist must see the same words on the screen; silently correcting
# the text would make the digital and paper forms disagree. The script only
# REPORTS them so somebody can decide, with the source document's owner,
# whether to amend the form itself.
#
# Keyed by (collapsed xlsx block title, 1-based item index) so the reviewed
# entry can be re-checked against the live parse every run - if the source is
# ever fixed, the check below says so instead of flagging a ghost.
REVIEWED_SOURCE_TYPOS = (
    {
        "title": "SANITARY INSPECTION OF PORT",
        "item_index": 7,
        "expect_fragment": "SANTARY",
        "note": "SANTARY -> SANITARY (missing I); written verbatim",
    },
    {
        "title": "SANITARY INSPECTION OF VESSEL",
        "item_index": 4,
        "expect_fragment": "DISINFECTION IF THE",
        "note": "'IF THE' almost certainly means 'OF THE'; written verbatim",
    },
    {
        "title": "SANITARY INSPECTION OF VESSEL",
        "item_index": 10,
        "expect_fragment": "EQUIPMENTS",
        "note": "EQUIPMENTS -> EQUIPMENT; written verbatim",
    },
    {
        "title": (
            "SANITARY INSPECTION OF DAY CARE, PRE-SCHOOL SERVICES "
            "AND CHILDREN'S INSTITUTION"
        ),
        "item_index": 13,
        "expect_fragment": "CARE AND PREPARATION FOOD",
        "note": "reads as if 'OF' is missing before FOOD; written verbatim",
    },
    {
        "title": "LIVESTOCK FARM SANITARY INSPECTION CHECKLIST",
        "item_index": 6,
        "expect_fragment": "Blogas",
        "note": "Blogas -> Biogas; written verbatim",
    },
    {
        "title": "SANITARY INSPECTION OF PUBLIC PLACES",
        "item_index": 12,
        "expect_fragment": "Facilitiies",
        "note": (
            "Facilitiies -> Facilities; XLSX ONLY - live doc '52' already "
            "reads 'Secondary Treatment Facilities' (the original seeder "
            "corrected it). Nothing to fix in Firestore; listed so the "
            "source document's defect is on the record."
        ),
    },
    {
        "title": "SANITARY INSPECTION OF PUBLIC PLACES",
        "item_index": 14,
        "expect_fragment": "Receptable",
        "note": (
            "Receptable -> Receptacle; PRE-EXISTING live doc '54', "
            "this script does not rewrite item_name"
        ),
    },
)

# What the source document must look like, in sheet order: (collapsed title,
# item count). A parse that disagrees means the xlsx changed under us and the
# run aborts rather than seeding whatever it happened to find.
# Sheet revision of 2026-10-02. The nine DEMERITS blocks are byte-identical to
# the previous revision; what changed is that LIVESTOCK FARM is now filled in and
# has moved from a third side-by-side column at the top to its own block at the
# bottom, so it is now discovered last rather than third.
EXPECTED_BLOCKS = (
    ("SANITARY INSPECTION OF SWIMMING POOL AND BATHHOUSE PLACES", 20),
    ("SANITARY INSPECTION OF PUBLIC PLACES", 20),
    ("SANITARY INSPECTION OF FOOD ESTABLISHMENT", 20),
    ("SANITARY INSPECTION OF LAUNDRY ESTABLISHMENTS", 20),
    (
        "SANITARY INSPECTION OF HOTELS, MOTELS, APARTMENT, "
        "CONDOMINUM & TRANSIENT HOUSE",
        20,
    ),
    ("SANITARY INSPECTION OF SUPERMARKETS", 20),
    ("SANITARY INSPECTION OF VESSEL", 20),
    ("SANITARY INSPECTION OF PORT", 20),
    (
        "SANITARY INSPECTION OF DAY CARE, PRE-SCHOOL SERVICES "
        "AND CHILDREN'S INSTITUTION",
        20,
    ),
    # 13 numbered items, not 20, and scored COMPLIANT rather than DEMERITS.
    # The 38 fill-in sub-lines beneath those items are deliberately NOT items;
    # see _parse_block and report_livestock_model().
    ("LIVESTOCK FARM SANITARY INSPECTION CHECKLIST", 13),
)


# =============================================================================
# OUTPUT HELPERS
# =============================================================================

def out(text=""):
    """Print ASCII-safe.

    The console on the operator's machine is cp1252, so a stray curly quote
    pasted into the source spreadsheet would otherwise kill the run with a
    UnicodeEncodeError halfway through printing a 120-row diff. Only the
    terminal copy is sanitized - what goes to Firestore keeps the original
    characters byte for byte.
    """
    s = str(text)
    print(s.encode("ascii", "replace").decode("ascii"))


def banner(title):
    out()
    out("=" * 78)
    out(title)
    out("=" * 78)


def section(title):
    out()
    out("-- " + title + " " + "-" * max(0, 74 - len(title)))


def now_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def log_line(text):
    with open(LOG_FILE, "a", encoding="utf-8") as fh:
        fh.write(now_iso() + "  " + text + "\n")


def fmt_value(value):
    """Render a field value unambiguously, so '5' and 5 cannot be confused."""
    if isinstance(value, str):
        return '"' + value + '"'
    if value is None:
        return "<missing>"
    return repr(value)


def fmt_doc(data):
    return "{" + ", ".join(
        k + "=" + fmt_value(data[k]) for k in sorted(data)
    ) + "}"


# =============================================================================
# ITEM-NAME NORMALIZATION
# =============================================================================

_ENUM_PREFIX_RE = re.compile(r"^\s*\d+\s*\.\s*")
_WS_RUN_RE = re.compile(r"\s+")
_SLASH_WS_RE = re.compile(r"\s*/\s*")


def collapse_ws(text):
    return _WS_RUN_RE.sub(" ", str(text)).strip()


# [REF: CHUNK25_NORMALIZE]
# Reverse-engineered from the original seed by diffing the live documents against
# the source sheet: the first seeder stripped the printed enumeration, squashed
# the spreadsheet's ragged spacing, and tightened spaces around slashes. It also
# did two things this function deliberately does NOT do - it substituted
# placeholder names for the four untitled Public Places cells (live '41'-'44'
# hold 'Item 1'..'Item 4' where the sheet has bare integers) and it corrected one
# typo (live '52'). Those were judgement calls on a block this script never
# rewrites, so only the three mechanical steps are reproduced here.
# New rows must go through exactly the same three steps or the
# collection ends up with two spellings of the same convention
# ('Lavatory/Handwashing Facilities' next to '9. Lavatory / Handwashing
# Facilities'), which is how a checklist silently grows duplicate items.
# Capitalization, wording and source typos are preserved verbatim; see
# REVIEWED_SOURCE_TYPOS for why.
def normalize_item_name(raw):
    text = _ENUM_PREFIX_RE.sub("", str(raw))
    text = collapse_ws(text)
    return _SLASH_WS_RE.sub("/", text)


# =============================================================================
# XLSX PARSING
# =============================================================================

_TERMINATORS = ("TOTAL DEMERITS", "REMARKS")

# Titles sit exactly two rows above their header in all ten blocks, so a short
# scan is sufficient rather than protective: the nearest preceding 'REMARKS:' is
# six or seven rows up, already out of reach. What actually stops a block from
# adopting the previous block's trailer is the _is_terminator() skip in
# _find_block_title; this cap only bounds the search.
_MAX_TITLE_LOOKUP_ROWS = 4

# Livestock Farm has a header and no items at all; a run of blanks is how a
# block with nothing in it ends, since it has no TOTAL DEMERITS row either.
_MAX_BLANK_RUN = 2


def _cell(ws, row, col):
    value = ws.cell(row=row, column=col).value
    if value is None:
        return ""
    return collapse_ws(value)


def _is_terminator(text):
    upper = text.upper()
    return any(upper.startswith(t) for t in _TERMINATORS)


# [REF: CHUNK25_XLSX_PARSE]
# The sheet is a GRID of checklist blocks, not a table: three blocks sit
# side by side across columns B, G/H and L, then the next band of blocks starts
# ~28 rows down. There is no schema to read, so blocks are located structurally.
# A cell reading 'ITEMS' anchors a block; the scoring column is immediately to
# its right ('DEMERITS', or 'COMPLIANT ( )' for Livestock Farm); a sub-category
# column may sit immediately to its LEFT, blank in the header row and
# forward-filled down the items (and merged, which is why only the top cell of
# each run carries a value); the title is the nearest non-empty cell above, in
# either the item column or that sub-category column, because the title cells
# are merged ranges anchored one column left of the items in the G/H block.
# Items run downward until a TOTAL DEMERITS / REMARKS row.
def parse_checklist_blocks(xlsx_path):
    if not os.path.exists(xlsx_path):
        out("ERROR: source document not found: " + xlsx_path)
        sys.exit(2)

    workbook = openpyxl.load_workbook(xlsx_path, data_only=True)
    if SHEET_NAME not in workbook.sheetnames:
        out("ERROR: expected sheet '" + SHEET_NAME + "' in " + xlsx_path)
        out("       found: " + ", ".join(workbook.sheetnames))
        sys.exit(2)
    ws = workbook[SHEET_NAME]

    anchors = []
    for row in range(1, ws.max_row + 1):
        for col in range(1, ws.max_column + 1):
            if _cell(ws, row, col).upper() == "ITEMS":
                anchors.append((row, col))

    blocks = []
    for header_row, item_col in anchors:
        blocks.append(_parse_block(ws, header_row, item_col))
    return blocks


def _parse_block(ws, header_row, item_col):
    title, title_row = _find_block_title(ws, header_row, item_col)

    rows = []
    blanks = 0
    row = header_row + 1
    while row <= ws.max_row:
        text = _cell(ws, row, item_col)
        if text and _is_terminator(text):
            break
        if not text:
            blanks += 1
            if blanks >= _MAX_BLANK_RUN:
                break
            row += 1
            continue
        blanks = 0
        rows.append((row, text))
        row += 1
    end_row = row

    sub_col = _find_sub_column(ws, header_row, item_col, end_row)

    # [REF: CHUNK25_COMPLIANT_BLOCK]
    # A DEMERITS block is a flat list: every non-blank row is a scored item. The
    # single COMPLIANT block is two levels - enumerated rows carry the compliance
    # mark, and the unenumerated rows below each one are fill-in evidence lines
    # ('_____Drinking', '_____m, Septic Tank (Domestic)'). Treating those as items
    # would invent 38 scored rows the paper form does not score, so they are
    # attached to their parent and reported, never seeded.
    scoring = "COMPLIANT" if _cell(
        ws, header_row, item_col + 1
    ).upper().startswith("COMPLIANT") else "DEMERITS"

    if scoring == "COMPLIANT":
        parented = []
        for item_row, raw in rows:
            if _ENUM_PREFIX_RE.match(raw):
                parented.append((item_row, raw, []))
            elif parented:
                parented[-1][2].append((item_row, raw))
            else:
                # An unenumerated row before the first numbered item would be a
                # layout we have never seen; refuse to guess where it belongs.
                raise AssertionError(
                    "COMPLIANT block at row %d starts with an unenumerated row "
                    "%d (%r) - the parser cannot attach it to an item"
                    % (header_row, item_row, raw)
                )
        rows = [(r, raw) for r, raw, _kids in parented]
        sub_fields = {r: kids for r, _raw, kids in parented}
    else:
        sub_fields = {}

    items = []
    current_sub = DEFAULT_SUB_CATEGORY
    for item_row, raw in rows:
        if sub_col is not None:
            sub_raw = _cell(ws, item_row, sub_col)
            if sub_raw:
                # Merged sub-category cells only carry a value on their first
                # row, so the label applies downward until the next one.
                current_sub = normalize_item_name(sub_raw)
        items.append(
            {
                "row": item_row,
                "raw": raw,
                "item_name": normalize_item_name(raw),
                "sub_category": current_sub,
                "sub_fields": [
                    {"row": r, "raw": t} for r, t in sub_fields.get(item_row, [])
                ],
            }
        )

    return {
        "title": title,
        "title_collapsed": collapse_ws(title),
        "title_row": title_row,
        "header_row": header_row,
        "item_col": _col_letter(item_col),
        "sub_col": _col_letter(sub_col) if sub_col else None,
        "demerit_header": _cell(ws, header_row, item_col + 1),
        "scoring": scoring,
        "items": items,
    }


def _find_block_title(ws, header_row, item_col):
    candidate_cols = [item_col]
    if item_col > 1:
        candidate_cols.append(item_col - 1)
    for offset in range(1, _MAX_TITLE_LOOKUP_ROWS + 1):
        row = header_row - offset
        if row < 1:
            break
        for col in candidate_cols:
            text = _cell(ws, row, col)
            if not text or _is_terminator(text) or text.upper() == "ITEMS":
                continue
            return text, row
    return "", None


def _find_sub_column(ws, header_row, item_col, end_row):
    """A sub-category column is blank in the header row but labelled below it."""
    if item_col <= 1:
        return None
    col = item_col - 1
    if _cell(ws, header_row, col):
        return None  # that is another block's scoring/measures column
    for row in range(header_row + 1, end_row):
        if _cell(ws, row, col):
            return col
    return None


def _col_letter(col_index):
    if not col_index:
        return None
    return get_column_letter(col_index)


def report_parse(blocks):
    section("SOURCE DOCUMENT PARSE")
    for block in blocks:
        out(
            "  %-78s cols %-6s sub %-4s items %2d  (title row %s, header row %d)"
            % (
                block["title_collapsed"],
                block["item_col"],
                block["sub_col"] or "-",
                len(block["items"]),
                block["title_row"],
                block["header_row"],
            )
        )


def check_parse(blocks):
    """The xlsx is the authority; if it is not the one we measured, stop."""
    problems = []
    found = [(b["title_collapsed"], len(b["items"])) for b in blocks]
    if len(found) != len(EXPECTED_BLOCKS):
        problems.append(
            "expected %d checklist blocks, parsed %d"
            % (len(EXPECTED_BLOCKS), len(found))
        )
    for index, expected in enumerate(EXPECTED_BLOCKS):
        actual = found[index] if index < len(found) else None
        if actual != expected:
            problems.append(
                "block %d: expected %r, parsed %r" % (index + 1, expected, actual)
            )
    titles = [t for t, _ in found]
    for title in set(titles):
        if titles.count(title) > 1:
            problems.append("duplicate block title parsed: " + title)
    return problems


def report_typos(blocks):
    """Print the reviewed defects, and say so if the source has moved on."""
    by_title = {b["title_collapsed"]: b for b in blocks}
    section("SOURCE DOCUMENT TYPOS - PRESERVED VERBATIM, NOT CORRECTED")
    out("  These are defects in the paper form. They are written to Firestore")
    out("  exactly as printed so the screen matches the sheet in an inspector's")
    out("  hand. Decide with the form's owner whether to amend the source.")
    out()
    for entry in REVIEWED_SOURCE_TYPOS:
        block = by_title.get(entry["title"])
        index = entry["item_index"]
        if block is None or index > len(block["items"]):
            out(
                "  [STALE REVIEW] %s item %d no longer exists - reviewed typo "
                "list needs updating" % (entry["title"], index)
            )
            continue
        item = block["items"][index - 1]
        state = "CONFIRMED" if entry["expect_fragment"] in item["raw"] else "GONE?"
        out("  [%s] %s item %d" % (state, entry["title"], index))
        out('      raw  : "' + item["raw"] + '"')
        out('      live : "' + item["item_name"] + '"')
        out("      note : " + entry["note"])
        if state == "GONE?":
            out(
                "      WARNING: expected fragment '%s' not found - the source "
                "document may have been corrected since review."
                % entry["expect_fragment"]
            )
    out()
    out("  (This list is hand-reviewed, not heuristic. A guessing spell-checker")
    out("   over government form language produces noise, not signal.)")


# The mobile form resolves its checklist by category NAME, not by category_id:
# inspection_form_screen.dart:51-52 passes establishment.category straight into
# OfflineService.getLocalTemplatesByCategory, which compares it case-insensitively
# against ChecklistTemplate.category. Renaming a category and creating templates
# under a new name therefore changes which form an existing establishment opens,
# without this script ever writing to the establishments collection. The operator
# has to be told that, because it is invisible in the per-document diff.
def report_name_lookup_effects():
    section("SIDE EFFECTS VIA NAME-BASED CHECKLIST LOOKUP")
    out("  The Flutter form matches templates on the category NAME string, not")
    out("  on category_id (inspection_form_screen.dart:51-52 ->")
    out("  OfflineService.getLocalTemplatesByCategory, offline_service.dart:212).")
    out("  Consequences of this run that no per-document diff above shows:")
    out()
    out("  1. 'Brizamar beach resort' (category='Swimming Pool and Bathhouse',")
    out("     category_id=null) currently opens an EMPTY form. After this run it")
    out("     opens the new 20-item Swimming Pool and Bathhouse checklist,")
    out("     because the new templates carry that exact name. This is the")
    out("     intended outcome and needs no establishment write.")
    out()
    out("  2. The 14 establishments on category_id '9' are NOT broken today and")
    out("     are not being repaired by this run. syncData resolves '9' to the")
    out("     name 'Food' and the name lookup already finds the 20 Food")
    out("     templates. The plan's claim that repointing them is 'the move that")
    out("     makes a checklist appear' does not hold - category_id is already")
    out("     vestigial on this path.")
    out()
    out("  3. 'zafra' (category='Others') still opens an EMPTY form. No category")
    out("     named 'Others' exists and none is created.")
    out()
    out("  4. Name uniqueness now matters: two categories sharing a name would")
    out("     merge their templates into one form. After this run the only")
    out("     duplicate name left is 'Food' on '1' and held-back '9', and '9'")
    out("     has no templates, so nothing merges. Adding templates to '9'")
    out("     later would silently corrupt the Food checklist.")


def report_livestock_model(blocks):
    """Disclose everything about Livestock Farm that the diff cannot show."""
    block = next(
        b for b in blocks
        if b["title_collapsed"] == collapse_ws(
            "LIVESTOCK FARM SANITARY INSPECTION CHECKLIST")
    )
    entry = next(c for c in NEW_CATEGORIES if c["id"] == "17")
    dropped = [(i, sf) for i in block["items"] for sf in i["sub_fields"]]

    section("LIVESTOCK FARM - A DIFFERENT KIND OF FORM, READ THIS")
    out("  Scored %r in the source document, not DEMERITS. It is the only such"
        % block["demerit_header"])
    out("  block, and the only one whose items carry sub-fields.")
    out()
    out("  Seeded as its %d numbered items, because the COMPLIANT column is"
        % len(block["items"]))
    out("  ruled against those numbered rows. The %d fill-in lines beneath them"
        % len(dropped))
    out("  are evidence an inspector writes to justify each mark, and are NOT")
    out("  seeded as scored items. They are listed below so nothing is dropped")
    out("  silently.")
    out()
    out("  !!  weight is %d on all %d items, so until a per-category scoring   !!"
        % (entry["weight"], len(block["items"])))
    out("  !!  mode exists, a COMPLETED livestock inspection will display a    !!")
    out("  !!  score of 100 / Excellent. RatingProvider computes 100 minus     !!")
    out("  !!  total demerits (rating_provider.dart:56-66) and 0 demerits is   !!")
    out("  !!  a perfect score. weight 5 would be no better - it would invent  !!")
    out("  !!  a demerit scale the LGU has never published.                    !!")
    out()
    out("  Mitigation today: the form is unreachable. The mobile lookup matches")
    out("  on category NAME and no establishment is named 'Livestock Farm', so")
    out("  no inspector can open it until an admin assigns that category in the")
    out("  web dropdown. Fix the scoring mode before anyone does.")
    out()
    out("  The %d items being seeded (ids %d-%d):"
        % (len(block["items"]), entry["first_template_id"],
           entry["first_template_id"] + len(block["items"]) - 1))
    for index, item in enumerate(block["items"]):
        out("    [%d] %s" % (entry["first_template_id"] + index, item["item_name"]))
        for sf in item["sub_fields"]:
            out("           not seeded (row %d): %s" % (sf["row"], sf["raw"]))
    out()
    out("  Of those %d sub-fields, these need an input type the Pass/Fail/NA" % len(dropped))
    out("  card cannot express, and are the reason they are not seeded:")
    for item, sf in dropped:
        raw = sf["raw"]
        if re.search(r"_+\s*m\s*,", raw) or re.search(r"[Dd]istance\s*:", raw):
            kind = "a measurement in metres"
        elif re.search(r":\s*_*$", raw):
            kind = "free text"
        elif re.search(r"_+\s*[A-Za-z].*_+\s*[A-Za-z]", raw):
            kind = "a mutually exclusive choice"
        else:
            continue
        out("    %-46s -> %s" % (raw[:46], kind))


# =============================================================================
# FIRESTORE ACCESS
# =============================================================================

def resolve_key_path(cli_key):
    """--key wins, then GOOGLE_APPLICATION_CREDENTIALS, then the usual path."""
    if cli_key:
        return cli_key, "--key"
    env_key = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if env_key:
        return env_key, "GOOGLE_APPLICATION_CREDENTIALS"
    return DEFAULT_KEY_PATH, "default"


def read_project_id(key_path):
    """Read project_id straight out of the JSON - no SDK needed to show it."""
    try:
        with open(key_path, "r", encoding="utf-8") as fh:
            return json.load(fh).get("project_id", "<no project_id in key>")
    except (OSError, ValueError) as exc:
        return "<unreadable: %s>" % exc


def init_firestore(key_path):
    """Import and initialize the Admin SDK.

    Imported lazily and only here so that every other function in this file -
    the parser, the normalizer, the plan builder - can be exercised without the
    SDK being installed and, more importantly, without any chance of opening a
    connection to production while testing them.
    """
    try:
        import firebase_admin
        from firebase_admin import credentials, firestore
    except ImportError:
        out("Error: 'firebase-admin' package not found.")
        out("Install it by running: pip install firebase-admin")
        sys.exit(2)

    if not os.path.exists(key_path):
        out("Error: service account key not found: " + key_path)
        out("Pass one with --key or set GOOGLE_APPLICATION_CREDENTIALS.")
        sys.exit(2)

    cred = credentials.Certificate(key_path)
    firebase_admin.initialize_app(cred)
    return firestore.client()


def read_collection(db, name):
    return {doc.id: doc.to_dict() for doc in db.collection(name).stream()}


# =============================================================================
# PRECONDITIONS
# =============================================================================

def expected_template_ids():
    ids = {}
    for first, last, category_id in EXPECTED_TEMPLATE_BANDS:
        for n in range(first, last + 1):
            ids[str(n)] = category_id
    return ids


# [REF: CHUNK25_PRECONDITIONS]
# The whole plan below is hard-coded against a live state that was measured by
# hand at a point in time: ten categories with known names, sixty templates in
# three known id bands, and empty space where the new ids go. If anything has
# drifted since - somebody added a category in the admin UI, a previous run got
# half-committed, the xlsx was edited - then applying this plan would corrupt
# rather than repair. So the gate is total and the run aborts non-zero on the
# first disagreement, printing exactly what differs. This check is the reason
# a second --apply is harmless.
def check_preconditions(live_categories, live_templates, blocks):
    problems = []
    notes = []

    # ---- categories
    actual_ids = set(live_categories)
    expected_ids = set(EXPECTED_LIVE_CATEGORIES)
    for missing in sorted(expected_ids - actual_ids, key=_id_sort):
        problems.append("categories: expected doc '%s' is missing" % missing)
    for extra in sorted(actual_ids - expected_ids, key=_id_sort):
        problems.append(
            "categories: unexpected doc '%s' (name=%s) - live data has drifted"
            % (extra, fmt_value(live_categories[extra].get("name")))
        )
    for doc_id in sorted(expected_ids & actual_ids, key=_id_sort):
        data = live_categories[doc_id]
        expected_name = EXPECTED_LIVE_CATEGORIES[doc_id]
        if data.get("name") != expected_name:
            problems.append(
                "categories['%s'].name: expected %s, found %s"
                % (doc_id, fmt_value(expected_name), fmt_value(data.get("name")))
            )
        # sort_order is the one field this script is allowed to find already
        # present - a re-run after a partial manual fix. Anything else means the
        # document is not the shape verify() will demand after the commit.
        extra_fields = sorted(set(data) - {"name", "sort_order"})
        if extra_fields:
            problems.append(
                "categories['%s'] carries unexpected field(s) %s"
                % (doc_id, ", ".join(extra_fields))
            )
        if "sort_order" in data:
            notes.append(
                "categories['%s'] already has sort_order=%s - it will be "
                "overwritten with the planned value"
                % (doc_id, fmt_value(data.get("sort_order")))
            )

    # ---- no category already parked on a new id
    for entry in NEW_CATEGORIES:
        if entry["id"] in live_categories:
            problems.append(
                "categories['%s'] already exists (name=%s) - new-id band is not "
                "free; has this script already run?"
                % (entry["id"], fmt_value(live_categories[entry["id"]].get("name")))
            )

    # ---- checklist_templates
    expected_tmpl = expected_template_ids()
    if len(live_templates) != len(expected_tmpl):
        problems.append(
            "checklist_templates: expected %d docs, found %d"
            % (len(expected_tmpl), len(live_templates))
        )
    for missing in sorted(set(expected_tmpl) - set(live_templates), key=_id_sort):
        problems.append("checklist_templates: expected doc '%s' is missing" % missing)
    for extra in sorted(set(live_templates) - set(expected_tmpl), key=_id_sort):
        problems.append(
            "checklist_templates: unexpected doc '%s' (%s)"
            % (extra, fmt_doc(live_templates[extra]))
        )
    for doc_id, category_id in sorted(expected_tmpl.items(), key=lambda kv: _id_sort(kv[0])):
        data = live_templates.get(doc_id)
        if data is None:
            continue
        if data.get("category_id") != category_id:
            problems.append(
                "checklist_templates['%s'].category_id: expected %s, found %s"
                % (doc_id, fmt_value(category_id), fmt_value(data.get("category_id")))
            )
        # verify() asserts the post-commit `category` string on every band,
        # including the Food band this script never writes. Gate it here so a
        # drifted value is caught before the write rather than after it.
        expected_category = EXPECTED_LIVE_CATEGORIES.get(category_id)
        if data.get("category") != expected_category:
            problems.append(
                "checklist_templates['%s'].category: expected %s, found %s"
                % (doc_id, fmt_value(expected_category), fmt_value(data.get("category")))
            )
        # An unexpected field set is fatal rather than advisory because verify()
        # re-asserts the exact field set after the commit. Letting it through as
        # a note would print "PASS" to the operator, take an irreversible write,
        # and only then fail - the one ordering this gate exists to prevent.
        if set(data) != set(EXPECTED_TEMPLATE_FIELDS):
            problems.append(
                "checklist_templates['%s'] field set is %s, expected %s"
                % (doc_id, sorted(data), sorted(EXPECTED_TEMPLATE_FIELDS))
            )
        # Also fatal: verify() totals weights per category and only sums ints,
        # so a string "5" or a 4 here fails after the write rather than before it.
        if data.get("weight") != TEMPLATE_WEIGHT or not isinstance(
            data.get("weight"), int
        ):
            problems.append(
                "checklist_templates['%s'].weight is %s, expected int %d"
                % (doc_id, fmt_value(data.get("weight")), TEMPLATE_WEIGHT)
            )

    # ---- new template id band must be empty, and the vacant band left alone
    first, last = NEW_TEMPLATE_BAND
    for n in range(first, last + 1):
        doc_id = str(n)
        if doc_id in live_templates:
            problems.append(
                "checklist_templates['%s'] already exists (%s) - new-id band is "
                "not free; has this script already run?"
                % (doc_id, fmt_doc(live_templates[doc_id]))
            )
    vacant_first, vacant_last = VACANT_TEMPLATE_BAND
    occupied_vacant = [
        str(n)
        for n in range(vacant_first, vacant_last + 1)
        if str(n) in live_templates
    ]
    if occupied_vacant:
        problems.append(
            "checklist_templates: ids %s are occupied but were measured vacant"
            % ", ".join(occupied_vacant)
        )

    # ---- source document
    problems.extend("xlsx: " + p for p in check_parse(blocks))

    # ---- every new category must find its block
    by_title = {b["title_collapsed"]: b for b in blocks}
    for entry in NEW_CATEGORIES:
        key = collapse_ws(entry["xlsx_title"])
        block = by_title.get(key)
        if block is None:
            problems.append(
                "xlsx: no block titled '%s' for new category '%s'"
                % (key, entry["id"])
            )
            continue
        want = 0 if entry["first_template_id"] is None else entry["item_count"]
        if len(block["items"]) != want:
            problems.append(
                "xlsx: block '%s' has %d items, expected %d for category '%s'"
                % (key, len(block["items"]), want, entry["id"])
            )

    return problems, notes


def _id_sort(doc_id):
    """Numeric-string ids sort numerically; anything odd sorts last."""
    try:
        return (0, int(doc_id), "")
    except (TypeError, ValueError):
        return (1, 0, str(doc_id))


def report_preconditions(problems, notes, live_categories, live_templates, blocks):
    section("PRECONDITIONS")
    out("  categories          : %d docs" % len(live_categories))
    out("  checklist_templates : %d docs" % len(live_templates))
    out("  xlsx blocks         : %d" % len(blocks))
    out("  establishments      : NOT READ, NOT WRITTEN (out of scope)")
    out("  inspection_logs     : NOT READ, NOT WRITTEN (out of scope)")
    out()
    for note in notes:
        out("  [NOTE] " + note)
    if notes:
        out()
    if problems:
        out("  RESULT: FAIL - %d precondition problem(s):" % len(problems))
        for problem in problems:
            out("    - " + problem)
    else:
        out("  RESULT: PASS - live state matches the measured baseline exactly.")


# =============================================================================
# PLAN BUILDING
# =============================================================================

def build_operations(live_categories, live_templates, blocks, delete_nine):
    """Return the ordered list of write operations the batch will contain.

    Each op is a dict: action, collection, doc_id, before, after, fields, note.
    `fields` is what actually goes to Firestore for an update; `after` is the
    resulting document, for the human reading the diff.
    """
    ops = []
    by_title = {b["title_collapsed"]: b for b in blocks}

    delete_ids = list(CATEGORY_DELETIONS)
    if delete_nine:
        delete_ids.append(HELD_BACK_CATEGORY_ID)

    # ---- renames (plus sort_order folded in, when enabled)
    for doc_id in sorted(CATEGORY_RENAMES, key=_id_sort):
        old_name, new_name = CATEGORY_RENAMES[doc_id]
        before = dict(live_categories[doc_id])
        fields = {"name": new_name}
        if ADD_SORT_ORDER:
            fields["sort_order"] = SORT_ORDERS[doc_id]
        after = dict(before)
        after.update(fields)
        ops.append(
            {
                "action": "RENAME CATEGORY",
                "collection": CATEGORIES,
                "doc_id": doc_id,
                "before": before,
                "after": after,
                "fields": fields,
                "note": "name %s -> %s (the templates were never %s)"
                % (fmt_value(old_name), fmt_value(new_name), fmt_value(old_name)),
            }
        )

    # ---- sort_order-only updates on categories that keep their name
    if ADD_SORT_ORDER:
        for doc_id in ["1"] + ([] if delete_nine else [HELD_BACK_CATEGORY_ID]):
            before = dict(live_categories[doc_id])
            fields = {"sort_order": SORT_ORDERS[doc_id]}
            after = dict(before)
            after.update(fields)
            ops.append(
                {
                    "action": "UPDATE CATEGORY",
                    "collection": CATEGORIES,
                    "doc_id": doc_id,
                    "before": before,
                    "after": after,
                    "fields": fields,
                    "note": "sort_order only; name is correct and untouched",
                }
            )

    # ---- deletes
    for doc_id in sorted(delete_ids, key=_id_sort):
        note = "orphan duplicate 'Food' category, nothing references it"
        if doc_id == HELD_BACK_CATEGORY_ID:
            note = (
                "--delete-nine given: 14 establishments point at this id and "
                "their category dropdown will render empty until they are "
                "repointed"
            )
        ops.append(
            {
                "action": "DELETE CATEGORY",
                "collection": CATEGORIES,
                "doc_id": doc_id,
                "before": dict(live_categories[doc_id]),
                "after": None,
                "fields": None,
                "note": note,
            }
        )

    # ---- new categories
    for entry in NEW_CATEGORIES:
        data = {"name": entry["name"]}
        if ADD_SORT_ORDER:
            data["sort_order"] = SORT_ORDERS[entry["id"]]
        block = by_title[collapse_ws(entry["xlsx_title"])]
        item_count = len(block["items"])
        note = "from xlsx block '%s' (%d items)" % (
            block["title_collapsed"],
            item_count,
        )
        if item_count == 0:
            note += " - DELIBERATELY EMPTY, see warning above"
        ops.append(
            {
                "action": "CREATE CATEGORY",
                "collection": CATEGORIES,
                "doc_id": entry["id"],
                "before": None,
                "after": data,
                "fields": data,
                "note": note,
            }
        )

    # ---- stale denormalized category strings on existing templates
    if FIX_TEMPLATE_CATEGORY_STRING:
        for first, last, old_name, new_name in TEMPLATE_CATEGORY_STRING_FIXES:
            for n in range(first, last + 1):
                doc_id = str(n)
                before = dict(live_templates[doc_id])
                fields = {"category": new_name}
                after = dict(before)
                after.update(fields)
                ops.append(
                    {
                        "action": "UPDATE TEMPLATE",
                        "collection": TEMPLATES,
                        "doc_id": doc_id,
                        "before": before,
                        "after": after,
                        "fields": fields,
                        "note": "denormalized category %s -> %s after the rename"
                        % (fmt_value(old_name), fmt_value(new_name)),
                    }
                )

    # ---- new templates, one per xlsx item, id base+(i-1) == xlsx item i
    for entry in NEW_CATEGORIES:
        first_id = entry["first_template_id"]
        if first_id is None:
            continue
        block = by_title[collapse_ws(entry["xlsx_title"])]
        # The declared count is cross-checked against the sheet so a revision
        # that adds or drops an item cannot silently shift the id band.
        assert len(block["items"]) == entry["item_count"], (
            "'%s' parsed %d items, NEW_CATEGORIES declares %d"
            % (entry["name"], len(block["items"]), entry["item_count"])
        )
        weight = entry.get("weight", TEMPLATE_WEIGHT)
        for index, item in enumerate(block["items"]):
            doc_id = str(first_id + index)
            data = {
                "category": entry["name"],
                "category_id": entry["id"],
                "item_name": item["item_name"],
                "sub_category": item["sub_category"],
                "weight": weight,
            }
            ops.append(
                {
                    "action": "CREATE TEMPLATE",
                    "collection": TEMPLATES,
                    "doc_id": doc_id,
                    "before": None,
                    "after": data,
                    "fields": data,
                    "note": "xlsx item %d of '%s' (row %d)"
                    % (index + 1, block["title_collapsed"], item["row"]),
                }
            )

    return ops


def check_operations(ops):
    """Structural self-checks on the plan, independent of the live state."""
    problems = []
    for op in ops:
        if op["collection"] not in ALLOWED_COLLECTIONS:
            problems.append(
                "op targets collection '%s', which is out of scope" % op["collection"]
            )
    seen = set()
    for op in ops:
        key = (op["collection"], op["doc_id"])
        if key in seen:
            problems.append("two operations target %s/%s" % key)
        seen.add(key)
    if len(ops) > 500:
        problems.append(
            "%d operations exceeds the 500-op Firestore batch limit; the plan "
            "would have to be split and would stop being atomic" % len(ops)
        )
    for op in ops:
        if op["action"] == "CREATE TEMPLATE":
            if set(op["after"]) != set(EXPECTED_TEMPLATE_FIELDS):
                problems.append(
                    "new template '%s' field set %s != live shape %s"
                    % (op["doc_id"], sorted(op["after"]), sorted(EXPECTED_TEMPLATE_FIELDS))
                )
            if not op["after"]["item_name"]:
                problems.append("new template '%s' has an empty item_name" % op["doc_id"])
    return problems


# =============================================================================
# DIFF REPORT
# =============================================================================

_ACTION_ORDER = (
    "RENAME CATEGORY",
    "UPDATE CATEGORY",
    "DELETE CATEGORY",
    "CREATE CATEGORY",
    "CREATE TEMPLATE",
    "UPDATE TEMPLATE",
)


def report_plan(ops, delete_nine):
    # The transcript is the operator's only basis for approving a production
    # write, so it must be provably exhaustive: an op whose action is missing
    # from _ACTION_ORDER would be committed without ever being printed.
    unrenderable = sorted({op["action"] for op in ops} - set(_ACTION_ORDER))
    if unrenderable:
        raise AssertionError(
            "report_plan cannot render action(s) %s - the diff would omit "
            "operations that the batch would still commit" % ", ".join(unrenderable)
        )

    rendered = 0
    for action in _ACTION_ORDER:
        group = [op for op in ops if op["action"] == action]
        if not group:
            continue
        section("%s - %d doc(s)" % (action, len(group)))
        for op in sorted(group, key=lambda o: _id_sort(o["doc_id"])):
            _report_op(op)
            rendered += 1
    assert rendered == len(ops), "printed %d of %d operations" % (rendered, len(ops))

    if not delete_nine:
        section("HELD BACK ON PURPOSE - CATEGORY '9'")
        out("  Category '9' ('Food') is a duplicate exactly like the six deleted")
        out("  above, and it is NOT being deleted by this run.")
        out()
        out("  Reason: 14 of the 21 establishments still carry category_id '9'.")
        out("  Deleting it now would make the web admin's category dropdown")
        out("  (AddEstablishmentModal.tsx) render with nothing selected whenever")
        out("  an officer edits one of those 14, and repointing establishments is")
        out("  explicitly a later session's scope - this script never writes to")
        out("  the establishments collection.")
        out()
        if ADD_SORT_ORDER:
            out("  It is parked at sort_order %d so it sinks to the bottom of the"
                % SORT_ORDERS[HELD_BACK_CATEGORY_ID])
            out("  picker instead of sitting next to the real 'Food' entry.")
            out()
        out("  To delete it anyway, re-run with --delete-nine. Do that only after")
        out("  those 14 establishments have been repointed at category '1'.")


def _report_op(op):
    header = "  [%s] %s/%s" % (op["action"], op["collection"], op["doc_id"])
    out(header)
    if op["note"]:
        out("      why   : " + op["note"])
    before = op["before"]
    after = op["after"]

    if before is None:
        out("      before: <no document>")
        for key in sorted(after):
            out("      after : %-13s = %s" % (key, fmt_value(after[key])))
        return

    if after is None:
        for key in sorted(before):
            out("      before: %-13s = %s" % (key, fmt_value(before[key])))
        out("      after : <document deleted>")
        return

    for key in sorted(set(before) | set(after)):
        old = before.get(key)
        new = after.get(key)
        marker = " " if old == new else "*"
        if old == new:
            out("     %s %-13s = %s  (unchanged)" % (marker, key, fmt_value(old)))
        else:
            out("     %s %-13s : %s -> %s" % (marker, key, fmt_value(old), fmt_value(new)))


def report_summary(ops, delete_nine):
    section("SUMMARY")
    counts = {}
    for op in ops:
        counts[op["action"]] = counts.get(op["action"], 0) + 1
    for action in _ACTION_ORDER:
        if action in counts:
            out("  %-18s %3d" % (action, counts[action]))
    out("  %-18s %3d operations in ONE atomic batch (limit 500)"
        % ("TOTAL", len(ops)))
    out()
    out("  Collections written : " + ", ".join(sorted(ALLOWED_COLLECTIONS)))
    out("  Collections untouched: establishments, inspection_logs, profiles")
    out()
    out("  Flags / constants in effect:")
    out("    --delete-nine                %s" % ("ON" if delete_nine else "off"))
    out("    ADD_SORT_ORDER               %s" % ("ON" if ADD_SORT_ORDER else "off"))
    out("    FIX_TEMPLATE_CATEGORY_STRING %s"
        % ("ON" if FIX_TEMPLATE_CATEGORY_STRING else "off"))
    if ADD_SORT_ORDER:
        out()
        out("  Note: the chunk brief counts 175 operations (2 renames + 6 deletes")
        out("  + 7 category creates + 120 template creates + 40 template updates).")
        out("  ADD_SORT_ORDER folds into the 2 renames and the 7 creates but adds")
        out("  sort_order-only updates for categories that keep their names, so")
        out("  the real total is %d. Still one batch, still atomic." % len(ops))


# =============================================================================
# APPLY
# =============================================================================

def apply_operations(db, ops, key_path, project_id, delete_nine):
    log_line(
        "RUN START  project=%s key=%s ops=%d delete_nine=%s sort_order=%s "
        "fix_category_string=%s"
        % (
            project_id,
            key_path,
            len(ops),
            delete_nine,
            ADD_SORT_ORDER,
            FIX_TEMPLATE_CATEGORY_STRING,
        )
    )

    batch = db.batch()
    for op in ops:
        ref = db.collection(op["collection"]).document(op["doc_id"])
        if op["action"].startswith("CREATE"):
            batch.set(ref, op["fields"])
        elif op["action"].startswith("DELETE"):
            batch.delete(ref)
        else:
            batch.update(ref, op["fields"])
        log_line(
            "%s  %s/%s  before=%s  write=%s"
            % (
                op["action"],
                op["collection"],
                op["doc_id"],
                fmt_doc(op["before"]) if op["before"] else "<none>",
                fmt_doc(op["fields"]) if op["fields"] else "<delete>",
            )
        )

    section("COMMITTING")
    out("  Committing %d operations as one batch..." % len(ops))
    # Every op was logged above, before the commit was attempted. Without this
    # handler a raised commit would leave an audit log that lists 177 intended
    # writes and records no outcome for any of them - unreadable afterwards,
    # which is the one thing an audit log must not be.
    try:
        batch.commit()
    except Exception as exc:
        log_line("COMMIT FAILED  ops=%d  %s: %s"
                 % (len(ops), type(exc).__name__, exc))
        out("  COMMIT FAILED: %s: %s" % (type(exc).__name__, exc))
        out("  A Firestore batch is atomic, so either all %d writes landed or"
            % len(ops))
        out("  none did. Re-run the dry run to see which it was before retrying.")
        raise
    out("  Commit returned without error.")
    log_line("COMMIT OK  ops=%d" % len(ops))


# =============================================================================
# POST-APPLY VERIFICATION
# =============================================================================

def expected_final_categories(delete_nine):
    final = {"1": "Food"}
    for doc_id, (_old, new) in CATEGORY_RENAMES.items():
        final[doc_id] = new
    for entry in NEW_CATEGORIES:
        final[entry["id"]] = entry["name"]
    if not delete_nine:
        final[HELD_BACK_CATEGORY_ID] = EXPECTED_LIVE_CATEGORIES[HELD_BACK_CATEGORY_ID]
    return final


def expected_final_templates():
    """doc_id -> (category_id, category name) for every end-state template."""
    final = {}
    live_names = {"1": "Food"}
    live_names.update({k: v[1] for k, v in CATEGORY_RENAMES.items()})
    for first, last, category_id in EXPECTED_TEMPLATE_BANDS:
        for n in range(first, last + 1):
            final[str(n)] = (category_id, live_names[category_id])
    for entry in NEW_CATEGORIES:
        first_id = entry["first_template_id"]
        if first_id is None:
            continue
        for offset in range(entry["item_count"]):
            final[str(first_id + offset)] = (entry["id"], entry["name"])
    return final


def expected_category_weight(category_id):
    """Per-item weight for a category. Only Livestock Farm differs from 5."""
    for entry in NEW_CATEGORIES:
        if entry["id"] == category_id:
            return entry.get("weight", TEMPLATE_WEIGHT)
    return TEMPLATE_WEIGHT


def verify(db, delete_nine):
    section("POST-APPLY VERIFICATION")
    results = []

    live_categories = read_collection(db, CATEGORIES)
    live_templates = read_collection(db, TEMPLATES)

    want_categories = expected_final_categories(delete_nine)
    results.append(
        (
            "categories doc count == %d" % len(want_categories),
            len(live_categories) == len(want_categories),
            "found %d: %s" % (len(live_categories), sorted(live_categories, key=_id_sort)),
        )
    )
    results.append(
        (
            "categories id set matches plan",
            set(live_categories) == set(want_categories),
            "missing=%s unexpected=%s"
            % (
                sorted(set(want_categories) - set(live_categories), key=_id_sort),
                sorted(set(live_categories) - set(want_categories), key=_id_sort),
            ),
        )
    )
    for doc_id in sorted(want_categories, key=_id_sort):
        data = live_categories.get(doc_id) or {}
        results.append(
            (
                "categories['%s'].name == %s" % (doc_id, fmt_value(want_categories[doc_id])),
                data.get("name") == want_categories[doc_id],
                "found " + fmt_value(data.get("name")),
            )
        )
        if ADD_SORT_ORDER:
            results.append(
                (
                    "categories['%s'].sort_order == %d" % (doc_id, SORT_ORDERS[doc_id]),
                    data.get("sort_order") == SORT_ORDERS[doc_id],
                    "found " + fmt_value(data.get("sort_order")),
                )
            )
    for doc_id in CATEGORY_DELETIONS:
        results.append(
            (
                "categories['%s'] is gone" % doc_id,
                doc_id not in live_categories,
                "still present",
            )
        )
    if delete_nine:
        results.append(
            (
                "categories['9'] is gone (--delete-nine)",
                HELD_BACK_CATEGORY_ID not in live_categories,
                "still present",
            )
        )

    want_templates = expected_final_templates()
    results.append(
        (
            "checklist_templates doc count == %d" % len(want_templates),
            len(live_templates) == len(want_templates),
            "found %d" % len(live_templates),
        )
    )
    results.append(
        (
            "checklist_templates id set matches plan",
            set(live_templates) == set(want_templates),
            "missing=%s unexpected=%s"
            % (
                sorted(set(want_templates) - set(live_templates), key=_id_sort),
                sorted(set(live_templates) - set(want_templates), key=_id_sort),
            ),
        )
    )

    per_category = {}
    weight_total = {}
    for doc_id, data in live_templates.items():
        category_id = data.get("category_id")
        per_category[category_id] = per_category.get(category_id, 0) + 1
        weight = data.get("weight")
        if isinstance(weight, int):
            weight_total[category_id] = weight_total.get(category_id, 0) + weight
    want_per_category = {}
    for _doc_id, (category_id, _name) in want_templates.items():
        want_per_category[category_id] = want_per_category.get(category_id, 0) + 1
    want_per_category.setdefault("17", 0)
    for category_id in sorted(want_per_category, key=_id_sort):
        want_count = want_per_category[category_id]
        got = per_category.get(category_id, 0)
        results.append(
            (
                "category '%s' has %d template(s)" % (category_id, want_count),
                got == want_count,
                "found %d" % got,
            )
        )
        if want_count:
            want_weight = want_count * expected_category_weight(category_id)
            results.append(
                (
                    "category '%s' weights total %d" % (category_id, want_weight),
                    weight_total.get(category_id, 0) == want_weight,
                    "found %s" % weight_total.get(category_id, 0),
                )
            )

    if FIX_TEMPLATE_CATEGORY_STRING:
        for doc_id in sorted(want_templates, key=_id_sort):
            _category_id, want_name = want_templates[doc_id]
            data = live_templates.get(doc_id) or {}
            if data.get("category") != want_name:
                results.append(
                    (
                        "checklist_templates['%s'].category == %s"
                        % (doc_id, fmt_value(want_name)),
                        False,
                        "found " + fmt_value(data.get("category")),
                    )
                )
        results.append(
            (
                "all %d template.category strings match their category name"
                % len(want_templates),
                all(
                    (live_templates.get(d) or {}).get("category") == n
                    for d, (_c, n) in want_templates.items()
                ),
                "see failures above",
            )
        )

    for doc_id in sorted(want_templates, key=_id_sort):
        data = live_templates.get(doc_id)
        if data is not None and set(data) != set(EXPECTED_TEMPLATE_FIELDS):
            results.append(
                (
                    "checklist_templates['%s'] has exactly the 5 live fields" % doc_id,
                    False,
                    "found " + str(sorted(data)),
                )
            )

    failed = 0
    for label, ok, detail in results:
        if ok:
            out("  [PASS] " + label)
        else:
            failed += 1
            out("  [FAIL] %s -- %s" % (label, detail))
    out()
    out("  %d assertion(s), %d failure(s)." % (len(results), failed))
    log_line("VERIFY  assertions=%d failures=%d" % (len(results), failed))
    return failed


# =============================================================================
# MAIN
# =============================================================================

def parse_args(argv):
    parser = argparse.ArgumentParser(
        description=(
            "Chunk 2.5: reshape Firestore categories/checklist_templates to "
            "match checklists.xlsx. Dry run unless --apply is given."
        )
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="actually write to PRODUCTION Firestore (default: dry run)",
    )
    parser.add_argument(
        "--delete-nine",
        action="store_true",
        help=(
            "also delete category '9'; off by default because 14 establishments "
            "still point at it"
        ),
    )
    parser.add_argument(
        "--key",
        default=None,
        help="service account JSON (default: the mobile repo's key, or "
             "GOOGLE_APPLICATION_CREDENTIALS)",
    )
    parser.add_argument(
        "--xlsx",
        default=DEFAULT_XLSX_PATH,
        help="authoritative source document (default: %s)" % DEFAULT_XLSX_PATH,
    )
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)
    key_path, key_source = resolve_key_path(args.key)
    project_id = read_project_id(key_path)

    banner("CHUNK 2.5 - CATEGORIES AND CHECKLIST TEMPLATES CLEANUP")
    out("  FIREBASE PROJECT : " + str(project_id))
    out("  credential       : %s  (from %s)" % (key_path, key_source))
    out("  source document  : " + args.xlsx)
    out("  mode             : " + ("APPLY" if args.apply else "DRY RUN (read-only)"))
    if args.apply:
        out()
        out("  *** THIS RUN WILL WRITE TO PRODUCTION FIRESTORE. ***")
        out("  *** Project '%s' - %s and %s will be modified."
            % (project_id, CATEGORIES, TEMPLATES))
        out("  *** establishments and inspection_logs are NOT touched.")
    else:
        out()
        out("  No writes will be made. Re-run with --apply to commit this plan.")
    if project_id != EXPECTED_PROJECT_ID:
        out()
        out("  [NOTE] credential project is '%s', this script was written against"
            % project_id)
        out("         '%s'. Check you are pointing at the right database."
            % EXPECTED_PROJECT_ID)

    blocks = parse_checklist_blocks(args.xlsx)
    report_parse(blocks)

    db = init_firestore(key_path)
    live_categories = read_collection(db, CATEGORIES)
    live_templates = read_collection(db, TEMPLATES)

    problems, notes = check_preconditions(live_categories, live_templates, blocks)
    report_preconditions(problems, notes, live_categories, live_templates, blocks)
    if problems:
        out()
        out("ABORTED: the live data or the source document does not match the")
        out("measured baseline this plan was built for. Nothing was written.")
        out("If this is a second --apply run, that is the expected outcome -")
        out("the first run already did the work.")
        return 1

    report_typos(blocks)
    report_name_lookup_effects()
    report_livestock_model(blocks)

    ops = build_operations(live_categories, live_templates, blocks, args.delete_nine)
    plan_problems = check_operations(ops)
    if plan_problems:
        section("PLAN SELF-CHECK")
        for problem in plan_problems:
            out("  [FAIL] " + problem)
        out()
        out("ABORTED: the computed plan is not internally consistent. Nothing "
            "was written.")
        return 1

    report_plan(ops, args.delete_nine)
    report_summary(ops, args.delete_nine)

    if not args.apply:
        banner("DRY RUN COMPLETE - NOTHING WAS WRITTEN")
        out("  Read the diff above, then re-run with --apply to commit it.")
        return 0

    apply_operations(db, ops, key_path, project_id, args.delete_nine)
    failures = verify(db, args.delete_nine)
    if failures:
        banner("APPLIED, BUT VERIFICATION FAILED")
        out("  The batch committed and the end state is NOT what was planned.")
        out("  Investigate before anybody uses the admin console or syncs a")
        out("  device; the audit trail is in " + LOG_FILE)
        log_line("RUN END  status=VERIFY_FAILED failures=%d" % failures)
        return 1

    banner("APPLIED AND VERIFIED")
    out("  End state matches the plan. Audit trail: " + LOG_FILE)
    out("  Next: Chunk 3 (picker) can rely on sort_order; repointing the 14")
    out("  establishments off category '9' remains open.")
    log_line("RUN END  status=OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
