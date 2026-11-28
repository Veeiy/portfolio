// GET /api/fleet
// The normalized Tessie snapshot for the home screen's fleet card.

import { requireAuth } from "../lib/auth.js";
import { json, methodNotAllowed } from "../lib/http.js";
import { getFleet, publicFleet, TessieError } from "../lib/tessie.js";

export default {
  async fetch(request) {
    if (request.method !== "GET") return methodNotAllowed("GET");
    const denied = await requireAuth(request);
    if (denied) return denied;

    try {
      const fleet = await getFleet();
      if (!fleet) return json({ configured: false });
      return json({ configured: true, ...publicFleet(fleet) });
    } catch (err) {
      if (err instanceof TessieError) {
        return json({ configured: true, error: "tessie_unavailable", message: err.message }, 502);
      }
      throw err;
    }
  },
};
