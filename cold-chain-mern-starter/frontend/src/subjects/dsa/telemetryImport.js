function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value.trim());
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(value.trim());
      if (row.some(cell => String(cell).trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (quoted) throw new Error("CSV contains an unclosed quoted field");
  row.push(value.trim());
  if (row.some(cell => String(cell).trim())) rows.push(row);
  return rows;
}

function normalizeTable(table, defaultShipmentId) {
  if (table.length < 2) return [];
  const headers = table[0].map(value => String(value).toLowerCase().replace(/[^a-z0-9]/g, ""));
  return table.slice(1).map((values, index) => {
    const raw = Object.fromEntries(headers.map((header, column) => {
      const value = values[column] ?? "";
      return [header, value !== "" && Number.isFinite(Number(value)) ? Number(value) : value];
    }));
    const row = Object.fromEntries(headers.map((header, column) => [header, values[column] ?? ""]));
    const numeric = value => value == null || value === "" ? null : Number(value);
    const timestamp = row.timestamp || row.recordedat;

    return {
      shipmentId: row.shipmentid || row.shipment || row.shipmentobjectid || defaultShipmentId,
      timestamp: timestamp instanceof Date
        ? timestamp.toISOString()
        : timestamp || new Date(Date.now() + index).toISOString(),
      temperature: numeric(row.temperature ?? row.temperaturec ?? row.tempc),
      humidity: numeric(row.humidity ?? row.humiditypercent),
      doorStatus: row.doorstatus || "unknown",
      fuelLevel: numeric(row.fuellevel ?? row.fuellevelpercent),
      brakeStatus: row.brakestatus || "unknown",
      location: {
        latitude: numeric(row.latitude),
        longitude: numeric(row.longitude),
        label: row.location || (row.routedistancekm ? `Route distance ${row.routedistancekm} km` : "")
      },
      sourceData: raw,
      isSimulated: false
    };
  });
}

export async function parseTelemetryFile(file, defaultShipmentId) {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    return normalizeTable(parseCsv(text), defaultShipmentId);
  }
  if (extension === "xlsx") {
    const { default: ExcelJS } = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const firstSheet = workbook.worksheets[0];
    if (!firstSheet) return [];
    const table = [];
    firstSheet.eachRow({ includeEmpty: false }, row => table.push(row.values.slice(1)));
    return normalizeTable(table, defaultShipmentId);
  }
  throw new Error("Choose a CSV or Excel (.xlsx) telemetry file");
}
