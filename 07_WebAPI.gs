/**
 * =====================================================================
 *  07_WebAPI.gs
 * ---------------------------------------------------------------------
 *  Read-only JSON API for the Cloudflare front-end pilot. Nothing in
 *  this file writes to any sheet — on purpose, while this integration
 *  is still being proven out. It mirrors the same joins refreshDashboard()
 *  already does (04_Dashboard.gs), just returns JSON instead of writing
 *  cells.
 *
 *  Reached through 06_Signatures.gs's doGet(), which now checks for a
 *  ?api=... parameter FIRST and routes here before falling through to
 *  its original signing-page behaviour. The token-based signing path
 *  below that check is completely untouched — see the 3-line addition
 *  documented in DEPLOY_STEPS.md.
 *
 *  Endpoint:  GET <Web App URL>?api=rentals
 *  Returns:   { rentals: [ { id, customer, assetModel, assetId, status,
 *              flags: { delivery, preInsp, postInsp, report, claim,
 *              hirarc, contract } }, ... ] }
 *  Unknown ?api= value returns { error: "..." } — Apps Script Web Apps
 *  can't set a custom HTTP status code on a normal response, so errors
 *  are signalled in the JSON body itself, not via status code.
 * =====================================================================
 */
function handleApiRequest_(e) {
  const api = e.parameter.api;
  if (api === 'rentals') {
    return jsonResponse_({ rentals: buildRentalsSummary_() });
  }
  return jsonResponse_({ error: 'Unknown api value "' + api + '"' });
}

function buildRentalsSummary_() {
  const rentalsSheet = getSpreadsheet_().getSheetByName(SHEETS.RENTALS);
  const data = rentalsSheet.getDataRange().getValues();
  const headers = data[0];

  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue; // skip blank rows
    const rental = {};
    headers.forEach(function (h, idx) { rental[h] = data[i][idx]; });
    const rentalId = rental['Rental ID'];
    if (!rentalId) continue;

    const customer = getRowById(SHEETS.CUSTOMERS, 'Customer ID', rental['Customer ID']);
    const asset = getRowById(SHEETS.ASSETS, 'Asset ID', rental['Asset ID']);
    const deliveries = getRowsWhere(SHEETS.DELIVERY_LOG, 'Rental ID', rentalId);
    const hirarcEvents = getRowsWhere(SHEETS.HIRARC_REGISTER, 'Rental ID', rentalId);
    const sigRequest = getRowsWhere(SHEETS.SIGNATURE_REQUESTS, 'Rental ID', rentalId)
      .filter(function (r) { return r['Document Type'] === 'Contract'; })[0];

    out.push({
      id: rentalId,
      customer: customer ? customer['Company Name'] : '',
      assetModel: asset ? asset['Model'] : '',
      assetId: rental['Asset ID'],
      status: rental['Status'] || '',
      flags: {
        delivery: deliveries.some(function (d) { return d['Leg'] === 'Outbound' && d['PDF Link']; }),
        preInsp: !!rental['Pre Inspection PDF Link'],
        postInsp: !!rental['Post Inspection PDF Link'],
        report: !!rental['Post-Rental Report PDF Link'],
        claim: !!rental['Damage Claim PDF Link'],
        hirarc: hirarcEvents.length > 0,
        contract: sigRequest ? sigRequest['Status'] : null,
      },
    });
  }
  return out;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
