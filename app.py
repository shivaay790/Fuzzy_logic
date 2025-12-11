import base64
import io
import re
from typing import List, Optional, Tuple

import pandas as pd
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from rapidfuzz import fuzz, process

SIMILARITY_THRESHOLD = 85  # balanced default: tolerant of minor spelling/order changes


def normalize_name(value: str) -> str:
    """Normalize supplier/vendor names for comparison."""
    text = str(value).strip().lower()
    text = re.sub(r"[-_]+", " ", text)  # treat hyphen/underscore as space
    text = re.sub(r"[^\w\s]", " ", text)  # drop punctuation (e.g., commas, periods)
    return " ".join(text.split())


def parse_amount(value) -> Optional[float]:
    """Parse currency-like strings into float; returns None if unusable."""
    if pd.isna(value):
        return None
    text = str(value).strip()
    if text == "":
        return None
    # Handle parentheses as negative numbers
    is_negative = text.startswith("(") and text.endswith(")")
    text = text.strip("()")
    # Remove currency symbols and thousands separators
    text = re.sub(r"[^\d\.\-]", "", text.replace(",", ""))
    if text in {"", "-", ".", "-."}:
        return None
    try:
        number = float(text)
        return -number if is_negative else number
    except ValueError:
        return None


def load_spreadsheet_bytes(data: bytes, filename: str, sheet_name: Optional[str] = None) -> pd.DataFrame:
    """Read CSV or Excel from bytes into a DataFrame."""
    name = filename.lower()
    buffer = io.BytesIO(data)
    if name.endswith(".csv"):
        return pd.read_csv(buffer)
    return pd.read_excel(buffer, sheet_name=sheet_name if sheet_name is not None else 0)


def process_matches(
    universal_df: pd.DataFrame,
    vendor_df: pd.DataFrame,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Match vendors to suppliers, update invoice totals, and return logs."""
    required_universal_cols = {"Supplier", "Default payment method", "Invoice Total"}
    required_vendor_cols = {"Vendor", "Invoice Amount"}

    if not required_universal_cols.issubset(universal_df.columns):
        missing = required_universal_cols - set(universal_df.columns)
        raise ValueError(f"Universal Database missing columns: {', '.join(missing)}")

    if not required_vendor_cols.issubset(vendor_df.columns):
        missing = required_vendor_cols - set(vendor_df.columns)
        raise ValueError(f"Vendor sheet missing columns: {', '.join(missing)}")

    # Clean vendor sheet:
    # - forward-fill vendor names for sections
    # - parse currency values
    # - capture the last non-null amount per contiguous vendor section
    vendor_work = vendor_df[["Vendor", "Invoice Amount"]].copy()
    vendor_work["Vendor"] = vendor_work["Vendor"].ffill()
    vendor_work["Invoice Amount"] = vendor_work["Invoice Amount"].apply(parse_amount)

    vendor_work = vendor_work.dropna(subset=["Vendor"])
    vendor_work["section_id"] = (vendor_work["Vendor"] != vendor_work["Vendor"].shift()).cumsum()

    section_totals = (
        vendor_work.groupby("section_id")
        .agg(
            Vendor=("Vendor", "last"),
            Invoice_Amount=("Invoice Amount", lambda s: s.dropna().iloc[-1] if not s.dropna().empty else None),
        )
        .dropna(subset=["Invoice_Amount"])
    )

    vendor_grouped = (
        section_totals.groupby("Vendor", as_index=False)["Invoice_Amount"].sum().rename(columns={"Invoice_Amount": "Invoice Amount"})
    )

    # Prepare supplier lookup structures
    universal_df = universal_df.copy()
    original_invoice = pd.to_numeric(universal_df["Invoice Total"], errors="coerce")
    invoice_totals = original_invoice.fillna(0)

    supplier_norm = universal_df["Supplier"].astype(str).apply(normalize_name)
    supplier_index_map = {name: idx for idx, name in supplier_norm.items()}
    supplier_norm_list = list(supplier_index_map.keys())

    matches_log = []
    unmatched_log = []

    for _, row in vendor_grouped.iterrows():
        vendor_name = row["Vendor"]
        amount = row["Invoice Amount"]
        vendor_norm = normalize_name(vendor_name)

        # Exact match first (case-insensitive)
        if vendor_norm in supplier_index_map:
            idx = supplier_index_map[vendor_norm]
            invoice_totals.iloc[idx] += amount
            matches_log.append(
                {
                    "vendor": vendor_name,
                    "supplier": universal_df.loc[idx, "Supplier"],
                    "match_type": "exact",
                    "score": 100,
                    "amount_added": amount,
                }
            )
            continue

        # Substring match (handles cases like hyphen/underscore joins or extra tokens)
        substring_idx = None
        for norm_name, idx in supplier_index_map.items():
            if vendor_norm and (vendor_norm in norm_name or norm_name in vendor_norm):
                substring_idx = idx
                break

        if substring_idx is not None:
            invoice_totals.iloc[substring_idx] += amount
            matches_log.append(
                {
                    "vendor": vendor_name,
                    "supplier": universal_df.loc[substring_idx, "Supplier"],
                    "match_type": "substring",
                    "score": 100,
                    "amount_added": amount,
                }
            )
            continue

        # Fuzzy match fallback
        if supplier_norm_list:
            candidate = process.extractOne(
                vendor_norm,
                supplier_norm_list,
                scorer=fuzz.token_sort_ratio,
                score_cutoff=SIMILARITY_THRESHOLD,
            )
        else:
            candidate = None

        if candidate:
            matched_norm, score, _ = candidate
            idx = supplier_index_map[matched_norm]
            invoice_totals.iloc[idx] += amount
            matches_log.append(
                {
                    "vendor": vendor_name,
                    "supplier": universal_df.loc[idx, "Supplier"],
                    "match_type": "fuzzy",
                    "score": score,
                    "amount_added": amount,
                }
            )
        else:
            unmatched_log.append(
                {
                    "vendor": vendor_name,
                    "amount": amount,
                }
            )

    # Reapply blanks where original was empty and no amount was added
    updated_invoice = invoice_totals.copy()
    updated_invoice[original_invoice.isna() & (invoice_totals == 0)] = pd.NA
    universal_df["Invoice Total"] = updated_invoice

    matches_df = pd.DataFrame(matches_log)
    unmatched_df = pd.DataFrame(unmatched_log)
    return universal_df, matches_df, unmatched_df


def to_excel_bytes(df: pd.DataFrame, sheet_name: str = "Universal Database") -> bytes:
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name=sheet_name)
    return buffer.getvalue()


def df_to_base64_excel(df: pd.DataFrame, sheet_name: str = "Universal Database") -> str:
    data = to_excel_bytes(df, sheet_name)
    return base64.b64encode(data).decode("utf-8")


def df_to_base64_csv(df: pd.DataFrame) -> str:
    data = df.to_csv(index=False).encode("utf-8")
    return base64.b64encode(data).decode("utf-8")


app = FastAPI(title="Vendor Invoice Matcher API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # adjust to specific origins in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/process")
async def process_files(
    universal_file: UploadFile = File(...),
    vendor_file: UploadFile = File(...),
    universal_sheet: Optional[str] = Form(None),
    vendor_sheet: Optional[str] = Form(None),
):
    try:
        universal_bytes = await universal_file.read()
        vendor_bytes = await vendor_file.read()

        universal_df = load_spreadsheet_bytes(universal_bytes, universal_file.filename, sheet_name=universal_sheet)
        vendor_df = load_spreadsheet_bytes(vendor_bytes, vendor_file.filename, sheet_name=vendor_sheet)

        updated_df, matches_df, unmatched_df = process_matches(universal_df, vendor_df)

        response = {
            "updated_universal_excel_b64": df_to_base64_excel(updated_df, sheet_name=universal_sheet or "Universal Database"),
            "updated_universal_filename": "updated_universal_database.xlsx",
            "matches": matches_df.to_dict(orient="records"),
            "unmatched": unmatched_df.to_dict(orient="records"),
        }

        if not unmatched_df.empty:
            response["unmatched_csv_b64"] = df_to_base64_csv(unmatched_df)
            response["unmatched_filename"] = "unmatched_vendors.csv"

        return JSONResponse(content=response)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)

