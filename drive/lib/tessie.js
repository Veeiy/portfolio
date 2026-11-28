// Read-only Tessie client: one call for the whole fleet, normalized into the
// small shape the UI and the model actually need.
//
// Endpoints used (developer.tessie.com):
//   GET /vehicles          latest state of every vehicle on the account
//   GET /{vin}/location    street address and saved-location name
//
// Units: Tessie's docs don't state them. The values are Tesla's vehicle data
// passed through, which reports range and odometer in miles, temperatures in
// Celsius and tire pressure in bar, whatever the car's display is set to.
// This module converts to the units the owner picked on the car's screen.

const BASE_URL = (process.env.TESSIE_BASE_URL || "https://api.tessie.com").replace(/\/+$/, "");
const FLEET_TTL_MS = 60_000;
const MOVED_THRESHOLD_DEG = 0.0005; // roughly 50 meters

let fleetCache = null; // { at, data }
const placeCache = new Map(); // vin -> { lat, lon, address, saved }

export class TessieError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function fleetConfigured() {
  return Boolean(process.env.TESSIE_TOKEN);
}

async function tessieGet(path, timeoutMs) {
  let response;
  try {
    response = await fetch(BASE_URL + path, {
      headers: {
        Authorization: "Bearer " + process.env.TESSIE_TOKEN,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new TessieError("Could not reach Tessie.", 0);
  }
  if (response.status === 401 || response.status === 403) {
    throw new TessieError("Tessie rejected the access token.", response.status);
  }
  if (!response.ok) {
    throw new TessieError("Tessie returned an error (" + response.status + ").", response.status);
  }
  return response.json();
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, places = 0) {
  if (value === null) return null;
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function statusOf(state, shift, charging) {
  if (shift === "D" || shift === "R" || shift === "N") return "Driving";
  if (charging === "Charging") return "Charging";
  if (state === "asleep") return "Asleep";
  if (state === "offline") return "Offline";
  return "Parked";
}

function normalize(item) {
  const s = item.last_state || {};
  const charge = s.charge_state || {};
  const drive = s.drive_state || {};
  const climate = s.climate_state || {};
  const vehicle = s.vehicle_state || {};
  const gui = s.gui_settings || {};

  const metric = String(gui.gui_distance_units || "").startsWith("km");
  const celsius = gui.gui_temperature_units === "C";
  const distance = (miles) => (miles === null ? null : round(metric ? miles * 1.609344 : miles));
  const temp = (c) => (c === null ? null : round(celsius ? c : (c * 9) / 5 + 32));
  const psi = (bar) => (bar === null ? null : round(bar * 14.5038));

  const tires = {
    fl: psi(num(vehicle.tpms_pressure_fl)),
    fr: psi(num(vehicle.tpms_pressure_fr)),
    rl: psi(num(vehicle.tpms_pressure_rl)),
    rr: psi(num(vehicle.tpms_pressure_rr)),
  };
  const hasTires = Object.values(tires).some((v) => v !== null);

  const charging = charge.charging_state || null;
  const shift = drive.shift_state || null;
  const vin = String(item.vin || s.vin || "");

  return {
    vin, // stays on the server; stripped before anything is sent to the browser
    id: vin.slice(-6) || "car",
    name: s.display_name || vehicle.vehicle_name || "Tesla",
    status: statusOf(s.state || null, shift, charging),
    battery: num(charge.battery_level),
    chargeLimit: num(charge.charge_limit_soc),
    range: distance(num(charge.battery_range)),
    charging,
    minutesToFull: charging === "Charging" ? num(charge.minutes_to_full_charge) : null,
    chargerPower: charging === "Charging" ? num(charge.charger_power) : null,
    locked: typeof vehicle.locked === "boolean" ? vehicle.locked : null,
    sentry: typeof vehicle.sentry_mode === "boolean" ? vehicle.sentry_mode : null,
    climateOn: typeof climate.is_climate_on === "boolean" ? climate.is_climate_on : null,
    insideTemp: temp(num(climate.inside_temp)),
    outsideTemp: temp(num(climate.outside_temp)),
    odometer: distance(num(vehicle.odometer)),
    tires: hasTires ? tires : null,
    software: String(vehicle.car_version || "").split(" ")[0] || null,
    units: { distance: metric ? "km" : "mi", temp: celsius ? "C" : "F" },
    lat: num(drive.latitude),
    lon: num(drive.longitude),
    reportedAt: num(vehicle.timestamp) || num(charge.timestamp) || num(drive.timestamp),
    address: null,
    savedLocation: null,
  };
}

// Looks up a street address only when a car has moved since the last lookup,
// so a parked fleet costs one Tessie call per refresh instead of one per car.
async function attachPlaces(vehicles) {
  await Promise.all(
    vehicles.map(async (v) => {
      if (!v.vin || v.lat === null || v.lon === null) return;
      const known = placeCache.get(v.vin);
      const moved =
        !known ||
        Math.abs(known.lat - v.lat) > MOVED_THRESHOLD_DEG ||
        Math.abs(known.lon - v.lon) > MOVED_THRESHOLD_DEG;
      if (moved) {
        try {
          const place = await tessieGet("/" + encodeURIComponent(v.vin) + "/location", 4000);
          placeCache.set(v.vin, {
            lat: v.lat,
            lon: v.lon,
            address: typeof place.address === "string" ? place.address : null,
            saved: typeof place.saved_location === "string" ? place.saved_location : null,
          });
        } catch {
          // Location is a nice-to-have; the rest of the snapshot still stands.
          return;
        }
      }
      const place = placeCache.get(v.vin);
      v.address = place.address;
      v.savedLocation = place.saved || null;
    }),
  );
}

// Returns null when Tessie isn't configured. Throws TessieError on failure.
export async function getFleet() {
  if (!fleetConfigured()) return null;
  if (fleetCache && Date.now() - fleetCache.at < FLEET_TTL_MS) return fleetCache.data;

  const raw = await tessieGet("/vehicles?only_active=true", 8000);
  const results = Array.isArray(raw && raw.results) ? raw.results : [];
  const vehicles = results.map(normalize);
  await attachPlaces(vehicles);

  const data = { fetchedAt: Date.now(), vehicles };
  fleetCache = { at: Date.now(), data };
  return data;
}

// What the browser gets: no VINs and no raw coordinates.
export function publicFleet(fleet) {
  return {
    fetchedAt: fleet.fetchedAt,
    vehicles: fleet.vehicles.map(({ vin, lat, lon, ...rest }) => rest),
  };
}

function ago(timestamp, now) {
  if (!timestamp) return "report time unknown";
  const minutes = Math.max(0, Math.round((now - timestamp) / 60000));
  if (minutes < 1) return "reported just now";
  if (minutes < 60) return "reported " + minutes + " min ago";
  const hours = Math.round(minutes / 60);
  if (hours < 48) return "reported " + hours + " h ago";
  return "reported " + Math.round(hours / 24) + " days ago";
}

// One readable line per car for the model's live context.
export function describeFleet(fleet, now = Date.now()) {
  if (!fleet.vehicles.length) return "Tessie is connected but reports no active vehicles.";
  return fleet.vehicles
    .map((v) => {
      const parts = [];
      if (v.battery !== null) {
        let battery = v.battery + "% battery";
        if (v.chargeLimit !== null) battery += " (limit " + v.chargeLimit + "%)";
        parts.push(battery);
      }
      if (v.range !== null) parts.push(v.range + " " + v.units.distance + " rated range");
      let state = v.status;
      if (v.status === "Charging") {
        const bits = [];
        if (v.chargerPower) bits.push(v.chargerPower + " kW");
        if (v.minutesToFull) bits.push(v.minutesToFull + " min to limit");
        if (bits.length) state += " (" + bits.join(", ") + ")";
      } else if (v.charging && v.charging !== "Disconnected") {
        state += ", charger " + v.charging.toLowerCase();
      }
      parts.push(state);
      if (v.locked !== null) parts.push(v.locked ? "locked" : "UNLOCKED");
      if (v.sentry !== null) parts.push(v.sentry ? "sentry on" : "sentry off");
      const where = v.savedLocation && v.address ? v.savedLocation + " (" + v.address + ")" : v.savedLocation || v.address;
      if (where) parts.push("at " + where);
      if (v.insideTemp !== null) parts.push("cabin " + v.insideTemp + v.units.temp);
      if (v.outsideTemp !== null) parts.push("outside " + v.outsideTemp + v.units.temp);
      if (v.tires) {
        const t = v.tires;
        const show = (x) => (x === null ? "?" : x);
        parts.push("tires FL " + show(t.fl) + " FR " + show(t.fr) + " RL " + show(t.rl) + " RR " + show(t.rr) + " psi");
      }
      if (v.odometer !== null) parts.push(v.odometer.toLocaleString("en-US") + " " + v.units.distance + " odometer");
      if (v.software) parts.push("software " + v.software);
      parts.push(ago(v.reportedAt, now));
      return "- " + v.name + ": " + parts.join("; ") + ".";
    })
    .join("\n");
}
