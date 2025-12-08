import io
import re
from typing import List, Optional, Tuple

import pandas as pd
import streamlit as st
from rapidfuzz import fuzz, process

SIMILARITY_THRESHOLD = 85  # balanced default: tolerant of minor spelling/order changes


def normalize_name(value: str) -> str:
    """Normalize supplier/vendor names for comparison."""
    text = str(value).strip().lower()
    text = re.sub(r"[-_]+", " ", text)
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


def load_spreadsheet(uploaded_file, sheet_name: Optional[str] = None) -> pd.DataFrame:
    """Read CSV or Excel into a DataFrame."""
    name = uploaded_file.name.lower()
    if name.endswith(".csv"):
        return pd.read_csv(uploaded_file)
    return pd.read_excel(uploaded_file, sheet_name=sheet_name if sheet_name is not None else 0)


def get_sheet_names(uploaded_file) -> List[str]:
    """Return sheet names for an Excel file; empty for CSV."""
    name = uploaded_file.name.lower()
    if name.endswith(".csv"):
        return []
    xls = pd.ExcelFile(uploaded_file)
    return list(xls.sheet_names)


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


def main():
    st.set_page_config(page_title="Vendor Invoice Matcher", page_icon="📄", layout="centered")
    st.title("Vendor Invoice Matcher")
    st.caption("Upload the Universal Database and a vendor invoice sheet to update totals.")

    st.markdown(
        """
        1. Upload the Universal Database (CSV or Excel).
        2. Upload the vendor-specific sheet (CSV or Excel).
        3. Click **Process** to update invoice totals.
        """
    )

    col1, col2 = st.columns(2)
    universal_file = col1.file_uploader("Universal Database (Sheet 1)", type=["csv", "xls", "xlsx"])
    vendor_file = col2.file_uploader("Vendor Invoice Sheet", type=["csv", "xls", "xlsx"])

    if universal_file:
        universal_sheet_options = get_sheet_names(universal_file)
        universal_sheet = None
        if universal_sheet_options:
            universal_sheet = st.selectbox(
                "Select Universal Database sheet",
                universal_sheet_options,
                index=0,
                key="universal_sheet",
            )
    else:
        universal_sheet = None

    if vendor_file:
        vendor_sheet_options = get_sheet_names(vendor_file)
        vendor_sheet = None
        if vendor_sheet_options:
            vendor_sheet = st.selectbox(
                "Select Vendor sheet",
                vendor_sheet_options,
                index=0,
                key="vendor_sheet",
            )
    else:
        vendor_sheet = None

    process_btn = st.button("Process", type="primary", use_container_width=True)

    if process_btn:
        if not universal_file or not vendor_file:
            st.error("Please upload both files before processing.")
            return

        try:
            universal_df = load_spreadsheet(universal_file, sheet_name=universal_sheet)
            vendor_df = load_spreadsheet(vendor_file, sheet_name=vendor_sheet)

            updated_df, matches_df, unmatched_df = process_matches(universal_df, vendor_df)

            st.success("Processing complete. Download the updated Universal Database below.")

            # Download buttons
            excel_bytes = to_excel_bytes(updated_df, sheet_name=universal_sheet or "Universal Database")
            st.download_button(
                label="Download Updated Universal Database (Excel)",
                data=excel_bytes,
                file_name="updated_universal_database.xlsx",
                mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                use_container_width=True,
            )

            if not unmatched_df.empty:
                unmatched_csv = unmatched_df.to_csv(index=False).encode("utf-8")
                st.download_button(
                    label="Download Unmatched Vendors Log (CSV)",
                    data=unmatched_csv,
                    file_name="unmatched_vendors.csv",
                    mime="text/csv",
                    use_container_width=True,
                )

            # Optional details
            with st.expander("Match summary"):
                st.write(f"Exact/Fuzzy matches: {len(matches_df)}")
                st.write(f"Unmatched vendors: {len(unmatched_df)}")
                if not matches_df.empty:
                    st.dataframe(matches_df)
                if not unmatched_df.empty:
                    st.dataframe(unmatched_df)

            st.subheader("Updated Universal Database preview")
            st.dataframe(updated_df)
        except Exception as exc:  # pragma: no cover - guarded UI path
            st.error(f"An error occurred: {exc}")


if __name__ == "__main__":
    main()

