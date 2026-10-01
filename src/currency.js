/* ======================================================================
   CLIENT CURRENCY — decides which currency the Client Portal shows money
   in, based on the client's country.

   Every amount in the database (budget, invoices, payments) is stored in
   PKR. Pakistan clients see PKR as-is; clients from any other country
   see USD ($), converted with PKR_PER_USD below.

   * Change PKR_PER_USD here whenever the rate moves — it is the only
     place that needs updating.
   * The admin side (ClientsPage) never calls setDisplayCurrency(), so it
     keeps showing PKR exactly as before. Only clientPortalApi.js sets it
     (on portal login/refresh) and resets it again on portal logout.
====================================================================== */

export const PKR_PER_USD = 280;

let displayCurrency = "PKR";

export function currencyForCountry(countryName, countryCode) {
  const code = String(countryCode || "").trim().toLowerCase();
  const name = String(countryName || "").trim().toLowerCase();
  if (code === "pk" || name === "pakistan") return "PKR";
  if (!code && !name) return "PKR"; // no country saved -> keep the old PKR behaviour
  return "USD";
}

export function setDisplayCurrency(code) {
  displayCurrency = code === "USD" ? "USD" : "PKR";
}

export function getDisplayCurrency() {
  return displayCurrency;
}

/** Format a PKR-stored amount in the current display currency. */
export function fmtMoney(n) {
  const pkr = Number(n || 0);
  if (displayCurrency === "USD") {
    const usd = pkr / PKR_PER_USD;
    return `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `PKR ${pkr.toLocaleString()}`;
}

/** Activity/update lines are saved as text like "PKR 5,000 payment
 *  received against INV-1001" — rewrite any PKR amount inside that text
 *  into the display currency so Activity Updates match the rest. */
export function convertMoneyInText(text) {
  if (displayCurrency !== "USD" || typeof text !== "string") return text;
  return text.replace(/PKR\s?(\d[\d,]*(?:\.\d+)?)/g, (_, num) => fmtMoney(Number(num.replace(/,/g, ""))));
}
